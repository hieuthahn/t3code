import { it } from "@effect/vitest";
import {
  type OrchestrationV2TurnItem,
  ProviderDriverKind,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import * as ProjectionStore from "./ProjectionStore.ts";
import * as PromptSuggestionHub from "./PromptSuggestionHub.ts";

const THREAD = ThreadId.make("thread-suggest");
const RUN = RunId.make("run-suggest");
const CODEX = ProviderDriverKind.make("codex");
const CLAUDE = ProviderDriverKind.make("claudeAgent");

const history = [
  { type: "user_message", text: "fix the parser and tell me when done" },
  { type: "assistant_message", text: "Fixed. Want me to run the tests?" },
] as unknown as ReadonlyArray<OrchestrationV2TurnItem>;

const projections = Layer.mock(ProjectionStore.ProjectionStoreV2)({
  getTurnStartHistory: () => Effect.succeed(history),
});

const hubWith = (suggest: (question: string) => Effect.Effect<Option.Option<string>>) =>
  PromptSuggestionHub.layer.pipe(
    Layer.provide(projections),
    Layer.provide(Layer.succeed(PromptSuggestionHub.PromptSuggester, { suggest })),
  );

const takeSuggestions = (count: number) =>
  Effect.gen(function* () {
    const hub = yield* PromptSuggestionHub.PromptSuggestionHub;
    return yield* hub.subscribe(THREAD).pipe(
      Stream.take(count),
      Stream.map((item) => item.suggestion),
      Stream.runCollect,
      Effect.map((items) => Array.from(items)),
      Effect.forkScoped,
    );
  });

describe("PromptSuggestionHub", () => {
  it.effect("replays the current suggestion and clears it for a new run", () =>
    Effect.gen(function* () {
      const hub = yield* PromptSuggestionHub.PromptSuggestionHub;
      yield* hub.offer({ threadId: THREAD, suggestion: '"run the tests"', by: "native" });
      const fiber = yield* takeSuggestions(2);
      yield* Effect.yieldNow;
      yield* hub.clear(THREAD);
      expect(yield* Fiber.join(fiber)).toEqual(["run the tests", null]);
    }).pipe(Effect.scoped, Effect.provide(hubWith(() => Effect.succeed(Option.none())))),
  );

  it.effect("asks Haiku after a Codex run with the run's last exchange", () =>
    Effect.gen(function* () {
      const hub = yield* PromptSuggestionHub.PromptSuggestionHub;
      const fiber = yield* takeSuggestions(2);
      yield* Effect.yieldNow;
      yield* hub.suggestAfterRun({ threadId: THREAD, runId: RUN, driver: CODEX });
      expect(yield* Fiber.join(fiber)).toEqual([null, "yes, run them"]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        hubWith((question) =>
          Effect.succeed(
            question.includes("Want me to run the tests?")
              ? Option.some("yes, run them")
              : Option.none(),
          ),
        ),
      ),
    ),
  );

  it.effect("leaves Claude runs to Claude's own suggestion", () =>
    Effect.gen(function* () {
      const hub = yield* PromptSuggestionHub.PromptSuggestionHub;
      yield* hub.suggestAfterRun({ threadId: THREAD, runId: RUN, driver: CLAUDE });
      const first = yield* hub.subscribe(THREAD).pipe(Stream.runHead);
      expect(Option.map(first, (item) => item.suggestion)).toEqual(Option.some(null));
    }).pipe(Effect.provide(hubWith(() => Effect.die("Claude runs must not ask Haiku")))),
  );

  it.effect("drops a Haiku answer that arrives after the next run started", () =>
    Effect.gen(function* () {
      const asked = yield* Deferred.make<void>();
      const answer = yield* Deferred.make<Option.Option<string>>();
      const program = Effect.gen(function* () {
        const hub = yield* PromptSuggestionHub.PromptSuggestionHub;
        const pending = yield* Effect.forkChild(
          hub.suggestAfterRun({ threadId: THREAD, runId: RUN, driver: CODEX }),
        );
        yield* Deferred.await(asked);
        yield* hub.clear(THREAD);
        yield* Deferred.succeed(answer, Option.some("stale suggestion"));
        yield* Fiber.join(pending);
        return yield* hub.subscribe(THREAD).pipe(Stream.runHead);
      });
      const first = yield* program.pipe(
        Effect.provide(
          hubWith(() => Deferred.succeed(asked, undefined).pipe(Effect.andThen(Deferred.await(answer)))),
        ),
      );
      expect(Option.map(first, (item) => item.suggestion)).toEqual(Option.some(null));
    }),
  );
});
