import type {
  OrchestrationV2ThreadStreamItem,
  OrchestrationV2TurnItem,
  OrchestrationV2TurnRecap,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../serverSettings.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { CARD_REQUEST_TYPES, isMultiStepRun, parseRecap, recapQuestion } from "./turnRecap.ts";

/**
 * The recap of each thread's last multi-step run, written by Haiku on a Claude account for
 * every provider. Never persisted: a new run clears it and a server restart forgets it.
 */
export interface TurnRecapHubShape {
  readonly clear: (threadId: ThreadId) => Effect.Effect<void>;
  readonly recapAfterRun: (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
  }) => Effect.Effect<void>;
  /** The thread's current recap, then each change. */
  readonly subscribe: (threadId: ThreadId) => Stream.Stream<TurnRecapItem>;
}

/** Answers a recap question with a quick model; provided by the server, absent in tests. */
export class TurnRecapper extends Context.Service<
  TurnRecapper,
  { readonly recap: (question: string) => Effect.Effect<Option.Option<string>> }
>()("t3/orchestration-v2/TurnRecapHub/TurnRecapper") {}

export type TurnRecapItem = Extract<
  OrchestrationV2ThreadStreamItem,
  { readonly kind: "prompt-suggestion" }
>;

export class TurnRecapHub extends Context.Service<TurnRecapHub, TurnRecapHubShape>()(
  "t3/orchestration-v2/TurnRecapHub",
) {}

/** Long enough for a cold `claude -p` start; the generation check drops a stale answer anyway. */
const RECAP_DEADLINE_MS = 30_000;
const MAX_THREADS = 256;

interface Change {
  readonly threadId: ThreadId;
  readonly recap: OrchestrationV2TurnRecap | null;
}

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const serverSettings = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
  const recapper = yield* Effect.serviceOption(TurnRecapper);
  const current = new Map<ThreadId, OrchestrationV2TurnRecap>();
  /** Bumped by each clear, so a recap asked before the clear cannot land after it. */
  const generations = new Map<ThreadId, number>();
  const changes = yield* PubSub.unbounded<Change>();

  const enabled = Option.isSome(serverSettings)
    ? serverSettings.value.getSettings.pipe(
        Effect.map((settings) => settings.turnRecaps),
        Effect.orElseSucceed(() => true),
      )
    : Effect.succeed(true);

  const publish = (change: Change) => PubSub.publish(changes, change).pipe(Effect.asVoid);

  const clear: TurnRecapHubShape["clear"] = (threadId) =>
    Effect.suspend(() => {
      generations.set(threadId, (generations.get(threadId) ?? 0) + 1);
      if (generations.size > MAX_THREADS) generations.delete(generations.keys().next().value!);
      if (!current.delete(threadId)) return Effect.void;
      return publish({ threadId, recap: null });
    });

  const recapAfterRun: TurnRecapHubShape["recapAfterRun"] = Effect.fn("TurnRecapHub.recapAfterRun")(
    function* ({ threadId, runId }) {
      if (Option.isNone(recapper) || !(yield* enabled)) return;
      const generation = generations.get(threadId) ?? 0;
      const history = yield* projections
        .getTurnStartHistory(threadId, [runId])
        .pipe(Effect.orElseSucceed((): ReadonlyArray<OrchestrationV2TurnItem> => []));
      const question = isMultiStepRun(history) ? recapQuestion(history) : undefined;
      if (question === undefined) return;
      const startedAt = yield* Clock.currentTimeMillis;
      const reply = yield* recapper.value.recap(question);
      const ms = (yield* Clock.currentTimeMillis) - startedAt;
      const parsed = Option.isSome(reply) ? parseRecap(reply.value) : undefined;
      const askedOnCard = yield* projections
        .getThreadRecords(threadId, ["turnItems"], {
          turnItemTypes: CARD_REQUEST_TYPES,
          turnItemRunId: runId,
        })
        .pipe(
          Effect.map((records) => records.turnItems.length > 0),
          Effect.orElseSucceed(() => false),
        );
      const recap =
        parsed !== undefined && askedOnCard ? { summary: parsed.summary, replies: [] } : parsed;
      if (recap === undefined || (generations.get(threadId) ?? 0) !== generation) {
        yield* Effect.logInfo("turn-recap", { threadId, chars: 0, ms });
        return;
      }
      current.delete(threadId);
      current.set(threadId, recap);
      if (current.size > MAX_THREADS) current.delete(current.keys().next().value!);
      yield* Effect.logInfo("turn-recap", { threadId, chars: recap.summary.length, ms });
      yield* publish({ threadId, recap });
    },
    Effect.timeoutOption(RECAP_DEADLINE_MS),
    Effect.asVoid,
    Effect.catchCause(() => Effect.void),
  );

  const subscribe: TurnRecapHubShape["subscribe"] = (threadId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const live = yield* PubSub.subscribe(changes);
        const initial: TurnRecapItem = {
          kind: "prompt-suggestion",
          recap: current.get(threadId) ?? null,
        };
        return Stream.concat(
          Stream.make(initial),
          Stream.fromSubscription(live).pipe(
            Stream.filter((change) => change.threadId === threadId),
            Stream.map((change): TurnRecapItem => ({
              kind: "prompt-suggestion",
              recap: change.recap,
            })),
          ),
        );
      }),
    );

  return TurnRecapHub.of({ clear, recapAfterRun, subscribe });
});

export const layer = Layer.effect(TurnRecapHub, make);
