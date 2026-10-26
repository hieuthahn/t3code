import type {
  OrchestrationV2ThreadStreamItem,
  OrchestrationV2TurnItem,
  ProviderDriverKind,
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
import { cleanSuggestion, suggestionQuestion } from "./promptSuggestion.ts";

/**
 * The predicted next prompt per thread. Never persisted: Claude sends its own after a turn,
 * other providers get one from Haiku on a Claude account, and a new run clears it.
 */
export interface PromptSuggestionHubShape {
  readonly offer: (input: {
    readonly threadId: ThreadId;
    readonly suggestion: string;
    readonly by: "native" | "haiku";
  }) => Effect.Effect<void>;
  readonly clear: (threadId: ThreadId) => Effect.Effect<void>;
  /** Asks Haiku for a suggestion after a run of a provider that sends none of its own. */
  readonly suggestAfterRun: (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
    readonly driver: ProviderDriverKind;
  }) => Effect.Effect<void>;
  /** The thread's current suggestion, then each change. */
  readonly subscribe: (threadId: ThreadId) => Stream.Stream<PromptSuggestionItem>;
}

/** Answers a suggestion question with a quick model; provided by the server, absent in tests. */
export class PromptSuggester extends Context.Service<
  PromptSuggester,
  { readonly suggest: (question: string) => Effect.Effect<Option.Option<string>> }
>()("t3/orchestration-v2/PromptSuggestionHub/PromptSuggester") {}

export type PromptSuggestionItem = Extract<
  OrchestrationV2ThreadStreamItem,
  { readonly kind: "prompt-suggestion" }
>;

export class PromptSuggestionHub extends Context.Service<
  PromptSuggestionHub,
  PromptSuggestionHubShape
>()("t3/orchestration-v2/PromptSuggestionHub") {}

const CLAUDE_DRIVER = "claudeAgent";
/** A suggestion that arrives later than this is dropped: the user has moved on. */
const SUGGEST_DEADLINE_MS = 8_000;
const MAX_THREADS = 256;

interface Change {
  readonly threadId: ThreadId;
  readonly suggestion: string | null;
}

export const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const serverSettings = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
  const suggester = yield* Effect.serviceOption(PromptSuggester);
  const current = new Map<ThreadId, string>();
  /** Bumped by each clear, so a suggestion asked before the clear cannot land after it. */
  const generations = new Map<ThreadId, number>();
  const changes = yield* PubSub.unbounded<Change>();

  const enabled = Option.isSome(serverSettings)
    ? serverSettings.value.getSettings.pipe(
        Effect.map((settings) => settings.promptSuggestions),
        Effect.orElseSucceed(() => true),
      )
    : Effect.succeed(true);

  const publish = (change: Change) => PubSub.publish(changes, change).pipe(Effect.asVoid);

  const offer: PromptSuggestionHubShape["offer"] = Effect.fn("PromptSuggestionHub.offer")(
    function* ({ threadId, suggestion, by }) {
      const text = cleanSuggestion(suggestion);
      if (text === undefined || !(yield* enabled)) return;
      current.delete(threadId);
      current.set(threadId, text);
      if (current.size > MAX_THREADS) current.delete(current.keys().next().value!);
      yield* Effect.logInfo("prompt-suggestion", { threadId, by, chars: text.length });
      yield* publish({ threadId, suggestion: text });
    },
  );

  const clear: PromptSuggestionHubShape["clear"] = (threadId) =>
    Effect.suspend(() => {
      generations.set(threadId, (generations.get(threadId) ?? 0) + 1);
      if (generations.size > MAX_THREADS) generations.delete(generations.keys().next().value!);
      if (!current.delete(threadId)) return Effect.void;
      return publish({ threadId, suggestion: null });
    });

  const suggestAfterRun: PromptSuggestionHubShape["suggestAfterRun"] = Effect.fn(
    "PromptSuggestionHub.suggestAfterRun",
  )(
    function* ({ threadId, runId, driver }) {
      if (driver === CLAUDE_DRIVER || Option.isNone(suggester) || !(yield* enabled)) return;
      const generation = generations.get(threadId) ?? 0;
      const startedAt = yield* Clock.currentTimeMillis;
      const history = yield* projections
        .getTurnStartHistory(threadId, [runId])
        .pipe(Effect.orElseSucceed((): ReadonlyArray<OrchestrationV2TurnItem> => []));
      const lastText = (type: "user_message" | "assistant_message") =>
        history.findLast(
          (item): item is Extract<OrchestrationV2TurnItem, { type: typeof type }> =>
            item.type === type && item.text.trim() !== "",
        )?.text;
      const userText = lastText("user_message");
      const assistantText = lastText("assistant_message");
      if (userText === undefined || assistantText === undefined) return;
      const reply = yield* suggester.value.suggest(suggestionQuestion({ userText, assistantText }));
      const ms = (yield* Clock.currentTimeMillis) - startedAt;
      if (Option.isNone(reply) || (generations.get(threadId) ?? 0) !== generation) {
        yield* Effect.logInfo("prompt-suggestion", { threadId, by: "haiku", chars: 0, ms });
        return;
      }
      yield* offer({ threadId, suggestion: reply.value, by: "haiku" });
    },
    Effect.timeoutOption(SUGGEST_DEADLINE_MS),
    Effect.asVoid,
    Effect.catchCause(() => Effect.void),
  );

  const subscribe: PromptSuggestionHubShape["subscribe"] = (threadId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const live = yield* PubSub.subscribe(changes);
        const initial: PromptSuggestionItem = {
          kind: "prompt-suggestion",
          suggestion: current.get(threadId) ?? null,
        };
        return Stream.concat(
          Stream.make(initial),
          Stream.fromSubscription(live).pipe(
            Stream.filter((change) => change.threadId === threadId),
            Stream.map((change): PromptSuggestionItem => ({
              kind: "prompt-suggestion",
              suggestion: change.suggestion,
            })),
          ),
        );
      }),
    );

  return PromptSuggestionHub.of({ offer, clear, suggestAfterRun, subscribe });
});

export const layer = Layer.effect(PromptSuggestionHub, make);
