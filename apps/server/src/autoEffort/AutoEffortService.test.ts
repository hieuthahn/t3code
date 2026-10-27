import { it } from "@effect/vitest";
import {
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect } from "vite-plus/test";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AutoEffort from "./AutoEffortService.ts";

const CLAUDE = ProviderInstanceId.make("claude-viet");
const CODEX = ProviderInstanceId.make("codex");
const CLAUDE_HIEU = ProviderInstanceId.make("claude-hieu");
const CLAUDE_DUNG = ProviderInstanceId.make("claude-dung");

const withSessionUsage = (base: ServerProvider, usedPercent: number): ServerProvider =>
  ({
    ...base,
    usageLimits: {
      checkedAt: "2026-10-22T00:00:00.000Z",
      windows: [{ id: "five_hour", kind: "session", label: "Session", usedPercent }],
    },
  }) as ServerProvider;

const effortDescriptor = (id: string, levels: ReadonlyArray<string>) => ({
  id,
  label: "Effort",
  type: "select" as const,
  options: levels.map((level) => ({ id: level, label: level })),
});

const provider = (
  instanceId: ProviderInstanceId,
  driver: string,
  optionId: string,
  levels: ReadonlyArray<string>,
): ServerProvider => ({
  instanceId,
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: "0.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-22T00:00:00.000Z",
  models: [
    {
      slug: "model",
      name: "model",
      isCustom: false,
      capabilities: { optionDescriptors: [effortDescriptor(optionId, levels)] },
    },
  ],
  slashCommands: [],
  skills: [],
});

const selection = (
  instanceId: ProviderInstanceId,
  optionId: string,
  autoEffort: boolean,
): ModelSelection => ({
  instanceId,
  model: "model",
  options: [
    { id: optionId, value: "medium" },
    { id: "autoEffort", value: autoEffort },
  ],
});

interface Harness {
  readonly haikuReply?: Effect.Effect<Option.Option<string>>;
  readonly jevBody?: unknown;
  readonly jevLatency?: Duration.Input;
  readonly jevKeyFile?: string;
  readonly judge?: "auto" | "haiku";
  readonly autoEffortDefault?: boolean;
  readonly levels?: ReadonlyArray<string>;
  readonly claudeUsedPercent?: number;
  readonly peers?: ReadonlyArray<ServerProvider>;
}

const run = <A>(
  harness: Harness,
  body: (input: {
    readonly service: AutoEffort.AutoEffortServiceShape;
    readonly haikuQuestions: Ref.Ref<ReadonlyArray<{ instanceId: string; question: string }>>;
    readonly jevAuthorization: Ref.Ref<ReadonlyArray<string>>;
    readonly sql: SqlClient.SqlClient;
  }) => Effect.Effect<A>,
) =>
  Effect.gen(function* () {
    const haikuQuestions = yield* Ref.make<ReadonlyArray<{ instanceId: string; question: string }>>(
      [],
    );
    const jevAuthorization = yield* Ref.make<ReadonlyArray<string>>([]);
    const layer = AutoEffort.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ProviderRegistry.ProviderRegistry)({
            getProviders: Effect.succeed([
              withSessionUsage(
                provider(
                  CLAUDE,
                  "claudeAgent",
                  "effort",
                  harness.levels ?? ["low", "medium", "high", "xhigh", "max"],
                ),
                harness.claudeUsedPercent ?? 10,
              ),
              ...(harness.peers ?? []),
              provider(CODEX, "codex", "reasoningEffort", [
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
              ]),
            ]),
          }),
          Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
            getInstance: (instanceId) =>
              Effect.succeed({
                judgeEffort: (question: string) =>
                  Ref.update(haikuQuestions, (list) => [...list, { instanceId, question }]).pipe(
                    Effect.andThen(
                      harness.haikuReply ??
                        Effect.succeed(Option.some('{"effort":"high","sure":0.9,"why":"big job"}')),
                    ),
                  ),
              } as never),
          }),
          ServerSettings.layerTest({
            autoEffortJudge: harness.judge ?? "auto",
            autoEffortDefault: harness.autoEffortDefault ?? true,
          }),
          FileSystem.layerNoop({
            readFileString: () =>
              harness.jevKeyFile === undefined
                ? Effect.die("no key file")
                : Effect.succeed(harness.jevKeyFile),
          }),
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Ref.update(jevAuthorization, (list) => [
                ...list,
                request.headers.authorization ?? "",
              ]).pipe(
                Effect.andThen(Effect.sleep(harness.jevLatency ?? 0)),
                Effect.as(
                  HttpClientResponse.fromWeb(request, Response.json(harness.jevBody ?? {})),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    return yield* Effect.gen(function* () {
      const service = yield* AutoEffort.AutoEffortService;
      const sql = yield* SqlClient.SqlClient;
      return yield* body({ service, haikuQuestions, jevAuthorization, sql });
    }).pipe(Effect.provide(layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory))));
  });

const request = (
  overrides: Partial<AutoEffort.AutoEffortRequest> = {},
): AutoEffort.AutoEffortRequest => ({
  threadId: ThreadId.make("thread-1"),
  driver: ProviderDriverKind.make("claudeAgent"),
  modelSelection: selection(CLAUDE, "effort", true),
  text: "review the whole repo and fix what you find",
  attachmentCount: 0,
  previousUserText: undefined,
  previousAssistantText: undefined,
  ...overrides,
});

const effortOf = (resolution: AutoEffort.AutoEffortResolution, optionId = "effort") =>
  resolution.modelSelection.options?.find((option) => option.id === optionId)?.value;

describe("AutoEffortService", () => {
  it.effect("leaves the selection alone when Auto effort is off", () =>
    run({}, ({ service, haikuQuestions }) =>
      Effect.gen(function* () {
        const resolution = yield* service.resolve(
          request({ modelSelection: selection(CLAUDE, "effort", false) }),
        );
        expect(resolution).toEqual({
          modelSelection: selection(CLAUDE, "effort", false),
          notice: undefined,
        });
        expect(yield* Ref.get(haikuQuestions)).toEqual([]);
      }),
    ),
  );

  it.effect("judges a thread that never set the switch only while the default is on", () =>
    Effect.gen(function* () {
      const untouched: ModelSelection = {
        instanceId: CLAUDE,
        model: "model",
        options: [{ id: "effort", value: "medium" }],
      };
      yield* run({ judge: "haiku" }, ({ service }) =>
        Effect.gen(function* () {
          expect(effortOf(yield* service.resolve(request({ modelSelection: untouched })))).toBe(
            "high",
          );
        }),
      );
      yield* run({ judge: "haiku", autoEffortDefault: false }, ({ service, haikuQuestions }) =>
        Effect.gen(function* () {
          const resolution = yield* service.resolve(request({ modelSelection: untouched }));
          expect(resolution.notice).toBeUndefined();
          expect(yield* Ref.get(haikuQuestions)).toEqual([]);
        }),
      );
    }),
  );

  it.effect("asks Haiku on the thread's own Claude account and applies its verdict", () =>
    run({ judge: "haiku" }, ({ service, haikuQuestions }) =>
      Effect.gen(function* () {
        const resolution = yield* service.resolve(request());
        expect(effortOf(resolution)).toBe("high");
        expect(resolution.notice).toBe("Auto effort: high · by Haiku · big job");
        const asked = yield* Ref.get(haikuQuestions);
        expect(asked.map((entry) => entry.instanceId)).toEqual([CLAUDE]);
        expect(asked[0]?.question).toContain("Next message:\nreview the whole repo");
      }),
    ),
  );

  it.effect("asks Haiku on the roomiest Claude account when the thread's own is full", () => {
    const peer = (instanceId: ProviderInstanceId, usedPercent: number) =>
      withSessionUsage(
        provider(instanceId, "claudeAgent", "effort", ["medium", "high"]),
        usedPercent,
      );
    return run(
      {
        judge: "haiku",
        claudeUsedPercent: 100,
        peers: [peer(CLAUDE_HIEU, 70), peer(CLAUDE_DUNG, 30)],
      },
      ({ service, haikuQuestions }) =>
        Effect.gen(function* () {
          expect(effortOf(yield* service.resolve(request()))).toBe("high");
          expect((yield* Ref.get(haikuQuestions)).map((entry) => entry.instanceId)).toEqual([
            CLAUDE_DUNG,
          ]);
        }),
    );
  });

  it.effect("judges a Codex thread through a Claude account and sets reasoningEffort", () =>
    run({ judge: "haiku" }, ({ service, haikuQuestions }) =>
      Effect.gen(function* () {
        const resolution = yield* service.resolve(
          request({
            driver: ProviderDriverKind.make("codex"),
            modelSelection: selection(CODEX, "reasoningEffort", true),
          }),
        );
        expect(effortOf(resolution, "reasoningEffort")).toBe("high");
        expect((yield* Ref.get(haikuQuestions)).map((entry) => entry.instanceId)).toEqual([CLAUDE]);
      }),
    ),
  );

  it.effect("steps a verdict down to the strongest level the model offers", () =>
    run(
      {
        judge: "haiku",
        levels: ["low", "medium"],
        haikuReply: Effect.succeed(Option.some('{"effort":"max"}')),
      },
      ({ service }) =>
        Effect.gen(function* () {
          expect(effortOf(yield* service.resolve(request()))).toBe("medium");
        }),
    ),
  );

  it.effect(
    "applies a named level and keeps the last verdict for a follow-up, without a judge",
    () =>
      run({ judge: "haiku" }, ({ service, haikuQuestions }) =>
        Effect.gen(function* () {
          const asked = yield* service.resolve(request({ text: "use max effort here" }));
          expect(effortOf(asked)).toBe("max");
          expect(asked.notice).toBe("Auto effort: max · as asked");
          const followUp = yield* service.resolve(
            request({ text: "ok", previousAssistantText: "Done, all tests pass." }),
          );
          expect(effortOf(followUp)).toBe("max");
          expect(followUp.notice).toBe("Auto effort: max · kept for a follow-up");
          expect(yield* Ref.get(haikuQuestions)).toEqual([]);
        }),
      ),
  );

  it.effect("starts on the manual effort when the judge misses the deadline", () =>
    run({ judge: "haiku", haikuReply: Effect.never }, ({ service }) =>
      Effect.gen(function* () {
        const fiber = yield* service.resolve(request()).pipe(Effect.forkChild);
        yield* TestClock.adjust("2999 millis");
        expect(fiber.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust("1 millis");
        const resolution = yield* Fiber.join(fiber);
        expect(effortOf(resolution)).toBe("medium");
        expect(resolution.notice).toBe("Auto effort: medium (judge unavailable)");
      }),
    ),
  );

  it.effect("applies a sure Jev verdict, read with the key from ~/.config/jev/.env, at once", () =>
    run(
      {
        judge: "auto",
        jevKeyFile: "TYPESAFE_API_KEY=ts_test\n",
        jevBody: { answers: { effort: { choice: "low", confidence: 0.92 } } },
        haikuReply: Effect.never,
      },
      ({ service, jevAuthorization }) =>
        Effect.gen(function* () {
          const resolution = yield* service.resolve(request({ text: "what does this flag do?" }));
          expect(effortOf(resolution)).toBe("low");
          expect(resolution.notice).toBe("Auto effort: low · by Jev · 92% sure");
          expect(yield* Ref.get(jevAuthorization)).toEqual(["Bearer ts_test"]);
        }),
    ),
  );

  it.effect("lets Haiku decide when Jev is unsure, and skips Jev when the judge is haiku", () =>
    Effect.gen(function* () {
      const unsure = {
        jevKeyFile: "TYPESAFE_API_KEY=ts_test\n",
        jevBody: { answers: { effort: { choice: "low", confidence: 0.3 } } },
      };
      yield* run({ ...unsure, judge: "auto" }, ({ service }) =>
        Effect.gen(function* () {
          expect(effortOf(yield* service.resolve(request()))).toBe("high");
        }),
      );
      yield* run({ ...unsure, judge: "haiku" }, ({ service, jevAuthorization }) =>
        Effect.gen(function* () {
          yield* service.resolve(request());
          expect(yield* Ref.get(jevAuthorization)).toEqual([]);
        }),
      );
    }),
  );

  it.effect("keeps Jev's unsure pick, marked low, when Haiku has no answer", () =>
    run(
      {
        jevKeyFile: "TYPESAFE_API_KEY=ts_test\n",
        jevBody: { answers: { effort: { choice: "low", confidence: 0.3 } } },
        haikuReply: Effect.succeed(Option.none()),
      },
      ({ service }) =>
        Effect.gen(function* () {
          const resolution = yield* service.resolve(request());
          expect(effortOf(resolution)).toBe("low");
          expect(resolution.notice).toBe("Auto effort: low · by Jev · 30% sure (low)");
        }),
    ),
  );

  it.effect("keeps Jev's unsure pick when Haiku misses the deadline", () =>
    run(
      {
        jevKeyFile: "TYPESAFE_API_KEY=ts_test\n",
        jevBody: { answers: { effort: { choice: "low", confidence: 0.3 } } },
        haikuReply: Effect.never,
      },
      ({ service }) =>
        Effect.gen(function* () {
          const fiber = yield* service.resolve(request()).pipe(Effect.forkChild);
          yield* TestClock.adjust("2999 millis");
          expect(fiber.pollUnsafe()).toBeUndefined();
          yield* TestClock.adjust("1 millis");
          const resolution = yield* Fiber.join(fiber);
          expect(effortOf(resolution)).toBe("low");
          expect(resolution.notice).toBe("Auto effort: low · by Jev · 30% sure (low)");
        }),
    ),
  );

  it.effect("gives Haiku the whole deadline while Jev is still answering", () =>
    run(
      {
        jevKeyFile: "TYPESAFE_API_KEY=ts_test\n",
        jevBody: { answers: { effort: { choice: "low", confidence: 0.3 } } },
        jevLatency: "900 millis",
        haikuReply: Effect.sleep("2500 millis").pipe(
          Effect.as(Option.some('{"effort":"high","sure":0.8,"why":"big job"}')),
        ),
      },
      ({ service }) =>
        Effect.gen(function* () {
          const fiber = yield* service.resolve(request()).pipe(Effect.forkChild);
          yield* TestClock.adjust("3 seconds");
          const resolution = yield* Fiber.join(fiber);
          expect(effortOf(resolution)).toBe("high");
          expect(resolution.notice).toBe("Auto effort: high · by Haiku · big job");
        }),
    ),
  );
});

describe("AutoEffortService team verdict", () => {
  const teamRequest = (
    overrides: Partial<AutoEffort.AutoTeamRequest> = {},
  ): AutoEffort.AutoTeamRequest => ({
    threadId: ThreadId.make("thread-1"),
    modelSelection: selection(CLAUDE, "effort", true),
    text: "build the billing module across server, web and the database",
    attachmentCount: 0,
    teamName: "Strong team",
    ...overrides,
  });
  const haikuSays = (json: string) => ({
    judge: "haiku" as const,
    haikuReply: Effect.succeed(Option.some(json)),
  });

  it.effect("starts a team when the judge says team, in one judge call", () =>
    run(
      haikuSays('{"effort":"high","sure":0.9,"why":"big job","team":true,"teamSure":0.8}'),
      ({ service, haikuQuestions }) =>
        Effect.gen(function* () {
          expect(yield* service.judgeTeam(teamRequest())).toBe(true);
          const resolution = yield* service.resolve(request({ firstTurn: true }));
          expect(effortOf(resolution)).toBe("high");
          expect(resolution.notice).toBe(
            "Auto effort: high · by Haiku · big job · team: Strong team, 80% sure",
          );
          const questions = yield* Ref.get(haikuQuestions);
          expect(questions).toHaveLength(1);
          expect(questions[0]?.question).toContain("Team:");
        }),
    ),
  );

  it.effect("keeps a single agent when the judge says single", () =>
    run(
      haikuSays('{"effort":"low","sure":0.9,"why":"quick fix","team":false,"teamSure":0.9}'),
      ({ service }) =>
        Effect.gen(function* () {
          expect(yield* service.judgeTeam(teamRequest({ text: "fix the typo in README" }))).toBe(
            false,
          );
          const resolution = yield* service.resolve(request({ firstTurn: true }));
          expect(resolution.notice).toBe("Auto effort: low · by Haiku · quick fix · single agent");
        }),
    ),
  );

  it.effect("keeps a single agent when the team verdict is below the threshold", () =>
    run(
      haikuSays('{"effort":"high","sure":0.9,"why":"big job","team":true,"teamSure":0.4}'),
      ({ service }) =>
        Effect.gen(function* () {
          expect(yield* service.judgeTeam(teamRequest())).toBe(false);
          const resolution = yield* service.resolve(request({ firstTurn: true }));
          expect(resolution.notice).toContain("single agent (team only 40% sure, needs 60% sure)");
        }),
    ),
  );

  it.effect("keeps a single agent when the judge is unavailable", () =>
    run({ judge: "haiku", haikuReply: Effect.succeed(Option.none()) }, ({ service }) =>
      Effect.gen(function* () {
        expect(yield* service.judgeTeam(teamRequest())).toBe(false);
        const resolution = yield* service.resolve(request({ firstTurn: true }));
        expect(resolution.notice).toContain("single agent (judge unavailable)");
      }),
    ),
  );

  it.effect("reads the team answer from Jev", () =>
    run(
      {
        jevKeyFile: "TYPESAFE_API_KEY=ts_test\n",
        jevBody: {
          answers: {
            effort: { choice: "high", confidence: 0.7 },
            team: { choice: "team", confidence: 0.9 },
          },
        },
      },
      ({ service }) =>
        Effect.gen(function* () {
          expect(yield* service.judgeTeam(teamRequest())).toBe(true);
          const resolution = yield* service.resolve(request({ firstTurn: true }));
          expect(resolution.notice).toBe(
            "Auto effort: high · by Jev · 70% sure · team: Strong team, 90% sure",
          );
        }),
    ),
  );

  it.effect("shows the team verdict on the first turn only, never on a follow-up", () =>
    run(
      haikuSays('{"effort":"high","sure":0.9,"why":"big job","team":true,"teamSure":0.8}'),
      ({ service }) =>
        Effect.gen(function* () {
          yield* service.judgeTeam(teamRequest());
          const first = yield* service.resolve(request({ firstTurn: true }));
          expect(first.notice).toContain("team: Strong team");
          const later = yield* service.resolve(
            request({ text: "now add tests for refunds", firstTurn: false }),
          );
          expect(later.notice).not.toContain("team");
          expect(yield* service.judgeTeam(teamRequest())).toBe(true);
        }),
    ),
  );

  const recorded = (sql: SqlClient.SqlClient) =>
    sql<{
      readonly thread_id: string;
      readonly run_ordinal: number;
      readonly team_before: number;
      readonly team_after: number;
      readonly judge_team: number | null;
      readonly team_sure: number | null;
      readonly judged_by: string;
      readonly team_name: string | null;
    }>`
      SELECT thread_id, run_ordinal, team_before, team_after, judge_team, team_sure, judged_by,
        team_name
      FROM auto_team_verdicts
    `.pipe(Effect.orDie);

  it.effect("records the verdict once per thread, with the judge's own answer", () =>
    run(
      haikuSays('{"effort":"high","sure":0.9,"why":"big job","team":true,"teamSure":0.4}'),
      ({ service, sql }) =>
        Effect.gen(function* () {
          yield* service.judgeTeam(teamRequest());
          yield* service.judgeTeam(teamRequest());
          expect(yield* recorded(sql)).toEqual([
            {
              thread_id: "thread-1",
              run_ordinal: 1,
              team_before: 0,
              team_after: 0,
              judge_team: 1,
              team_sure: 0.4,
              judged_by: "haiku",
              team_name: "Strong team",
            },
          ]);
        }),
    ),
  );

  it.effect("records a single agent verdict when the judge is unavailable", () =>
    run({ judge: "haiku", haikuReply: Effect.succeed(Option.none()) }, ({ service, sql }) =>
      Effect.gen(function* () {
        yield* service.judgeTeam(teamRequest({ teamName: undefined }));
        expect(yield* recorded(sql)).toEqual([
          {
            thread_id: "thread-1",
            run_ordinal: 1,
            team_before: 0,
            team_after: 0,
            judge_team: null,
            team_sure: null,
            judged_by: "fallback",
            team_name: null,
          },
        ]);
      }),
    ),
  );

  it.effect("shows the team verdict alone while Auto effort is off", () =>
    run(
      haikuSays('{"effort":"high","sure":0.9,"why":"big job","team":true,"teamSure":0.8}'),
      ({ service }) =>
        Effect.gen(function* () {
          yield* service.judgeTeam(teamRequest());
          const resolution = yield* service.resolve(
            request({ modelSelection: selection(CLAUDE, "effort", false), firstTurn: true }),
          );
          expect(resolution.notice).toBe("Team: Strong team, 80% sure");
          expect(effortOf(resolution)).toBe("medium");
        }),
    ),
  );
});
