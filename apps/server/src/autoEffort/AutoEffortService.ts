import {
  type ModelSelection,
  ProviderDriverKind,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { isSpentAccount } from "@t3tools/shared/usageLimitSwitchCandidates";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  clampToSupported,
  type EffortLevel,
  type EffortVerdict,
  effortOptionId,
  isAutoEffortOn,
  isFollowUp,
  type JudgeInput,
  jevRequestBody,
  judgeQuestion,
  namedEffort,
  parseJevAnswer,
  parseJevKey,
  parseJudgeVerdict,
  supportedEffortLevels,
  TEAM_SURE_THRESHOLD,
  wantsTeam,
  withEffort,
} from "./autoEffortJudgment.ts";

/** Past this a turn starts on its manual effort: a judge must not hold the prompt up. */
const JUDGE_DEADLINE_MS = 3_000;
const JEV_TIMEOUT_MS = 1_000;
/** Below this Jev's pick waits for Haiku, and stands only when Haiku has no answer. */
const JEV_SURE_THRESHOLD = 0.5;
const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** Usage of the fullest window; an unmeasured account ranks after every measured one. */
const fullestWindowPercent = (provider: ServerProvider): number => {
  const windows = provider.usageLimits?.windows;
  return windows === undefined || windows.length === 0
    ? Number.POSITIVE_INFINITY
    : Math.max(...windows.map((window) => window.usedPercent));
};

export interface AutoEffortRequest {
  readonly threadId: ThreadId;
  readonly driver: ProviderDriverKind;
  readonly modelSelection: ModelSelection;
  readonly text: string;
  readonly attachmentCount: number;
  readonly previousUserText: string | undefined;
  readonly previousAssistantText: string | undefined;
  /** True on the thread's first turn, the only one that shows the launch's team verdict. */
  readonly firstTurn?: boolean | undefined;
}

export interface AutoTeamRequest {
  readonly threadId: ThreadId;
  readonly modelSelection: ModelSelection;
  readonly text: string;
  readonly attachmentCount: number;
  /** The saved team the thread starts with when the verdict says team. */
  readonly teamName: string | undefined;
}

export interface AutoEffortResolution {
  readonly modelSelection: ModelSelection;
  /** What the turn shows about the choice; undefined when Auto effort is off. */
  readonly notice: string | undefined;
}

export interface AutoEffortServiceShape {
  readonly resolve: (request: AutoEffortRequest) => Effect.Effect<AutoEffortResolution>;
  /** Judges team or single agent from a thread's first message; false when unsure or unavailable. */
  readonly judgeTeam: (request: AutoTeamRequest) => Effect.Effect<boolean>;
}

export class AutoEffortService extends Context.Service<AutoEffortService, AutoEffortServiceShape>()(
  "t3/autoEffort/AutoEffortService",
) {}

type JudgedBy = "asked" | "follow-up" | "jev" | "haiku" | "fallback";

const JUDGED_BY_LABELS: Record<Exclude<JudgedBy, "fallback">, string> = {
  asked: "as asked",
  "follow-up": "kept for a follow-up",
  jev: "by Jev",
  haiku: "by Haiku",
};
interface Judged {
  readonly verdict: EffortVerdict;
  readonly by: JudgedBy;
  readonly instanceId?: ModelSelection["instanceId"] | undefined;
}

interface LaunchJudgment {
  readonly judged: Option.Option<Judged>;
  readonly team: boolean;
  readonly teamName: string | undefined;
}

const percent = (value: number) => `${Math.round(value * 100)}% sure`;

const isSure = (verdict: EffortVerdict) =>
  verdict.sure === undefined || verdict.sure >= JEV_SURE_THRESHOLD;

const markedLow = (verdict: EffortVerdict): EffortVerdict => ({
  ...verdict,
  why: `${verdict.why ?? "unsure"} (low)`,
});

const logJudgeMiss = (judge: "jev" | "haiku", reason: string, details: object) =>
  Effect.logWarning("auto-effort judge miss", { judge, reason, ...details });

/** The team half of the notice line. */
function teamNoticeText(launch: LaunchJudgment): string {
  if (Option.isNone(launch.judged)) return "single agent (judge unavailable)";
  const { teamSure } = launch.judged.value.verdict;
  if (launch.team) {
    const sure = teamSure === undefined ? "" : `, ${percent(teamSure)}`;
    return `team: ${launch.teamName ?? "default team"}${sure}`;
  }
  if (launch.judged.value.verdict.team === true && teamSure !== undefined) {
    return `single agent (team only ${percent(teamSure)}, needs ${percent(TEAM_SURE_THRESHOLD)})`;
  }
  return "single agent";
}

const make = Effect.gen(function* () {
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const instanceRegistry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const httpClient = yield* HttpClient.HttpClient;
  const lastJudged = yield* Ref.make(new Map<ThreadId, EffortLevel>());
  const launchJudged = yield* Ref.make(new Map<ThreadId, LaunchJudgment>());

  // The desktop server does not inherit a login shell, so the key file is the usual source.
  const jevKey = Effect.gen(function* () {
    const fromEnv = process.env.TYPESAFE_API_KEY?.trim();
    if (fromEnv) return Option.some(fromEnv);
    const home = yield* HostProcess.HomeDirectory;
    const file = yield* fileSystem.readFileString(`${home}/.config/jev/.env`);
    return Option.fromNullishOr(parseJevKey(file));
  }).pipe(Effect.catch(() => Effect.succeed(Option.none<string>())));

  const askJev = Effect.fn("AutoEffortService.askJev")(function* (key: string, input: JudgeInput) {
    const startedAt = yield* Clock.currentTimeMillis;
    const body = yield* httpClient
      .execute(
        HttpClientRequest.post(process.env.JEV_URL ?? JEV_URL).pipe(
          HttpClientRequest.bearerToken(key),
          HttpClientRequest.bodyText(jevRequestBody(input), "application/json"),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.json),
        Effect.timeoutOption(JEV_TIMEOUT_MS),
        Effect.result,
      );
    const ms = (yield* Clock.currentTimeMillis) - startedAt;
    if (Result.isFailure(body)) {
      yield* logJudgeMiss("jev", "error", { ms, error: String(body.failure) });
      return Option.none<EffortVerdict>();
    }
    if (Option.isNone(body.success)) {
      yield* logJudgeMiss("jev", "deadline", { ms });
      return Option.none<EffortVerdict>();
    }
    const verdict = parseJevAnswer(body.success.value);
    if (verdict === undefined) {
      yield* logJudgeMiss("jev", "unreadable", {
        ms,
        reply: encodeJson(body.success.value).slice(0, 200),
      });
    }
    return Option.fromNullishOr(verdict);
  });

  const judgeInstance = (
    request: AutoEffortRequest,
    providers: ReadonlyArray<ServerProvider>,
    textGenerationInstanceId: ModelSelection["instanceId"] | undefined,
    nowMs: number,
  ) => {
    const own = request.modelSelection.instanceId;
    if (request.driver === CLAUDE_DRIVER && !isSpentAccount(providers, own, nowMs)) return own;
    const claude = providers
      .filter(
        (provider) =>
          provider.driver === CLAUDE_DRIVER &&
          provider.enabled &&
          !isSpentAccount(providers, provider.instanceId, nowMs),
      )
      .toSorted((left, right) => fullestWindowPercent(left) - fullestWindowPercent(right));
    return (
      claude.find((provider) => provider.instanceId === textGenerationInstanceId)?.instanceId ??
      claude[0]?.instanceId
    );
  };

  const askHaiku = Effect.fn("AutoEffortService.askHaiku")(function* (
    instanceId: ModelSelection["instanceId"] | undefined,
    input: JudgeInput,
  ) {
    if (instanceId === undefined) return Option.none<EffortVerdict>();
    const instance = yield* instanceRegistry.getInstance(instanceId);
    if (instance?.judgeEffort === undefined) return Option.none<EffortVerdict>();
    const startedAt = yield* Clock.currentTimeMillis;
    const reply = yield* instance
      .judgeEffort(judgeQuestion(input))
      .pipe(Effect.timeoutOption(JUDGE_DEADLINE_MS));
    const ms = (yield* Clock.currentTimeMillis) - startedAt;
    if (Option.isNone(reply)) {
      yield* logJudgeMiss("haiku", "deadline", { instanceId, ms });
      return Option.none<EffortVerdict>();
    }
    if (Option.isNone(reply.value)) {
      yield* logJudgeMiss("haiku", "no warm process or no answer", { instanceId, ms });
      return Option.none<EffortVerdict>();
    }
    const verdict = parseJudgeVerdict(reply.value.value);
    if (verdict === undefined) {
      yield* logJudgeMiss("haiku", "unreadable", {
        instanceId,
        ms,
        reply: reply.value.value.slice(0, 200),
      });
    }
    return Option.fromNullishOr(verdict);
  });

  // Haiku starts with Jev so it has the whole deadline when Jev turns out unsure; each
  // judge carries its own timeout, so Jev's unsure pick survives a Haiku that runs out.
  const judge = Effect.fn("AutoEffortService.judge")(function* (
    request: AutoEffortRequest,
    input: JudgeInput,
    providers: ReadonlyArray<ServerProvider>,
  ) {
    const settings = yield* serverSettings.getSettings.pipe(Effect.option);
    const judgeSetting = Option.match(settings, {
      onNone: () => "auto" as const,
      onSome: (value) => value.autoEffortJudge,
    });
    const instanceId = judgeInstance(
      request,
      providers,
      Option.getOrUndefined(settings)?.textGenerationModelSelection.instanceId,
      yield* Clock.currentTimeMillis,
    );
    const haiku = yield* askHaiku(instanceId, input).pipe(Effect.forkChild);
    const key = judgeSetting === "haiku" ? Option.none<string>() : yield* jevKey;
    const jev = Option.isSome(key) ? yield* askJev(key.value, input) : Option.none<EffortVerdict>();
    if (Option.isSome(jev) && isSure(jev.value)) {
      yield* Fiber.interrupt(haiku);
      return Option.some<Judged>({ verdict: jev.value, by: "jev" });
    }
    const haikuVerdict = yield* Fiber.join(haiku);
    if (Option.isSome(haikuVerdict)) {
      return Option.some<Judged>({ verdict: haikuVerdict.value, by: "haiku", instanceId });
    }
    return Option.map(jev, (verdict): Judged => ({ verdict: markedLow(verdict), by: "jev" }));
  });

  const judgeTeam = Effect.fn("AutoEffortService.judgeTeam")(function* (request: AutoTeamRequest) {
    const stored = (yield* Ref.get(launchJudged)).get(request.threadId);
    if (stored !== undefined) return stored.team;
    const providers = yield* providerRegistry.getProviders;
    const provider = providers.find(
      (candidate) => candidate.instanceId === request.modelSelection.instanceId,
    );
    const effortRequest: AutoEffortRequest = {
      threadId: request.threadId,
      driver: provider?.driver ?? CLAUDE_DRIVER,
      modelSelection: request.modelSelection,
      text: request.text,
      attachmentCount: request.attachmentCount,
      previousUserText: undefined,
      previousAssistantText: undefined,
    };
    const optionId = effortOptionId(effortRequest.driver);
    const judged = yield* judge(
      effortRequest,
      {
        model: request.modelSelection.model,
        currentEffort:
          optionId === undefined
            ? undefined
            : getModelSelectionStringOptionValue(request.modelSelection, optionId),
        text: request.text,
        attachmentCount: request.attachmentCount,
        previousUserText: undefined,
        previousAssistantText: undefined,
        askTeam: true,
      },
      providers,
    );
    const team = wantsTeam(Option.getOrUndefined(judged)?.verdict);
    yield* Ref.update(launchJudged, (map) =>
      new Map(map).set(request.threadId, { judged, team, teamName: request.teamName }),
    );
    yield* Effect.logInfo("auto-team", {
      threadId: request.threadId,
      team,
      by: Option.getOrUndefined(judged)?.by ?? "fallback",
      teamSure: Option.getOrUndefined(judged)?.verdict.teamSure,
    });
    return team;
  });

  const takeLaunchJudgment = (threadId: ThreadId) =>
    Ref.modify(launchJudged, (map): [LaunchJudgment | undefined, Map<ThreadId, LaunchJudgment>] => {
      const found = map.get(threadId);
      if (found === undefined) return [undefined, map];
      const next = new Map(map);
      next.delete(threadId);
      return [found, next];
    });

  const resolve = Effect.fn("AutoEffortService.resolve")(function* (request: AutoEffortRequest) {
    const taken = yield* takeLaunchJudgment(request.threadId);
    const launch = request.firstTurn === true ? taken : undefined;
    const teamNotice = launch === undefined ? undefined : teamNoticeText(launch);
    const unchanged = {
      modelSelection: request.modelSelection,
      notice:
        teamNotice === undefined
          ? undefined
          : `${teamNotice.charAt(0).toUpperCase()}${teamNotice.slice(1)}`,
    };
    const optionId = effortOptionId(request.driver);
    const defaultOn = yield* serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.autoEffortDefault),
      Effect.orElseSucceed(() => true),
    );
    if (optionId === undefined || !isAutoEffortOn(request.modelSelection, defaultOn)) {
      return unchanged;
    }
    const startedAt = yield* Clock.currentTimeMillis;
    const providers = yield* providerRegistry.getProviders;
    const provider = providers.find(
      (candidate) => candidate.instanceId === request.modelSelection.instanceId,
    );
    const supported = supportedEffortLevels(provider, request.modelSelection.model);
    const manual = getModelSelectionStringOptionValue(request.modelSelection, optionId);
    const previous = (yield* Ref.get(lastJudged)).get(request.threadId);
    const input: JudgeInput = {
      model: request.modelSelection.model,
      currentEffort: previous ?? manual,
      text: request.text,
      attachmentCount: request.attachmentCount,
      previousUserText: request.previousUserText,
      previousAssistantText: request.previousAssistantText,
    };

    const asked = namedEffort(request.text);
    const judged: Option.Option<Judged> =
      asked !== undefined
        ? Option.some<Judged>({ verdict: { effort: asked }, by: "asked" })
        : launch !== undefined && Option.isSome(launch.judged)
          ? launch.judged
          : previous !== undefined &&
              request.attachmentCount === 0 &&
              isFollowUp(request.text, request.previousAssistantText)
            ? Option.some<Judged>({ verdict: { effort: previous }, by: "follow-up" })
            : yield* judge(request, input, providers);

    const effort = Option.flatMap(judged, ({ verdict }) =>
      Option.fromNullishOr(clampToSupported(verdict.effort, supported)),
    );
    const by: JudgedBy =
      Option.isSome(effort) && Option.isSome(judged) ? judged.value.by : "fallback";
    yield* Effect.logInfo("auto-effort", {
      threadId: request.threadId,
      driver: request.driver,
      model: request.modelSelection.model,
      effort: Option.getOrElse(effort, () => manual ?? "default"),
      by,
      judgedOn: Option.getOrUndefined(judged)?.instanceId,
      ms: (yield* Clock.currentTimeMillis) - startedAt,
    });
    if (Option.isNone(effort)) {
      return {
        modelSelection: request.modelSelection,
        notice: [`Auto effort: ${manual ?? "default"} (judge unavailable)`, teamNotice]
          .filter(Boolean)
          .join(" · "),
      };
    }
    yield* Ref.update(lastJudged, (map) => new Map(map).set(request.threadId, effort.value));
    const why = Option.isSome(judged) ? judged.value.verdict.why : undefined;
    const source = by === "fallback" ? undefined : JUDGED_BY_LABELS[by];
    return {
      modelSelection: withEffort(request.modelSelection, optionId, effort.value),
      notice: [`Auto effort: ${effort.value}`, source, why, teamNotice].filter(Boolean).join(" · "),
    };
  });

  return AutoEffortService.of({ resolve, judgeTeam });
});

export const layer = Layer.effect(AutoEffortService, make);

/** Keeps the Auto effort switch's default on every model in step with the setting. */
export const layerDefaultSync = Layer.effectDiscard(
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
    const initial = yield* serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.autoEffortDefault),
      Effect.orElseSucceed(() => true),
    );
    yield* providerRegistry.setAutoEffortDefault(initial);
    yield* serverSettings.streamChanges.pipe(
      Stream.map((settings) => settings.autoEffortDefault),
      Stream.changes,
      Stream.runForEach(providerRegistry.setAutoEffortDefault),
      Effect.forkScoped,
    );
  }),
);
