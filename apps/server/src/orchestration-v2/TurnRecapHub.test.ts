import { it } from "@effect/vitest";
import { type OrchestrationV2TurnItem, RunId, ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import * as ProjectionStore from "./ProjectionStore.ts";
import * as TurnRecapHub from "./TurnRecapHub.ts";

const THREAD = ThreadId.make("thread-recap");
const RUN = RunId.make("run-recap");
const RECAP_REPLY =
  '{"summary": "Parser fixed. Tests not run.", "question": "Run the tests?", "replies": ["Yes"]}';

const workRun = [
  { type: "user_message", text: "fix the parser" },
  { type: "file_change", fileName: "src/parser.ts" },
  { type: "assistant_message", text: "Fixed. Want me to run the tests?" },
] as unknown as ReadonlyArray<OrchestrationV2TurnItem>;

const hubWith = (
  history: ReadonlyArray<OrchestrationV2TurnItem>,
  recap: (question: string) => Effect.Effect<Option.Option<string>>,
  cards: ReadonlyArray<{ readonly runId: RunId; readonly type: string }> | "unreadable" = [],
) =>
  TurnRecapHub.layer.pipe(
    Layer.provide(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getTurnStartHistory: () => Effect.succeed(history),
        getThreadRecords: (threadId, _fields, filter) =>
          cards === "unreadable"
            ? Effect.fail(new ProjectionStore.ProjectionStoreThreadNotFoundError({ threadId }))
            : Effect.succeed({
                turnItems: cards.filter(
                  (card) =>
                    card.runId === filter?.turnItemRunId &&
                    filter.turnItemTypes?.some((type) => type === card.type),
                ),
              } as never),
      }),
    ),
    Layer.provide(Layer.succeed(TurnRecapHub.TurnRecapper, { recap })),
  );

const takeRecaps = (count: number) =>
  Effect.gen(function* () {
    const hub = yield* TurnRecapHub.TurnRecapHub;
    return yield* hub.subscribe(THREAD).pipe(
      Stream.take(count),
      Stream.map((item) => item.recap),
      Stream.runCollect,
      Effect.map((items) => Array.from(items)),
      Effect.forkScoped,
    );
  });

describe("TurnRecapHub", () => {
  it.effect("recaps a run that edited files and clears it for the next run", () =>
    Effect.gen(function* () {
      const hub = yield* TurnRecapHub.TurnRecapHub;
      const fiber = yield* takeRecaps(3);
      yield* Effect.yieldNow;
      yield* hub.recapAfterRun({ threadId: THREAD, runId: RUN });
      yield* hub.clear(THREAD);
      expect(yield* Fiber.join(fiber)).toEqual([
        null,
        { summary: "Parser fixed. Tests not run.", question: "Run the tests?", replies: ["Yes"] },
        null,
      ]);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        hubWith(workRun, (question) =>
          Effect.succeed(
            question.includes("- edited src/parser.ts") ? Option.some(RECAP_REPLY) : Option.none(),
          ),
        ),
      ),
    ),
  );

  it.effect("asks nothing after a run that only talked", () =>
    Effect.gen(function* () {
      const hub = yield* TurnRecapHub.TurnRecapHub;
      yield* hub.recapAfterRun({ threadId: THREAD, runId: RUN });
      const first = yield* hub.subscribe(THREAD).pipe(Stream.runHead);
      expect(Option.map(first, (item) => item.recap)).toEqual(Option.some(null));
    }).pipe(
      Effect.provide(
        hubWith([workRun[0]!, workRun[2]!], () =>
          Effect.die("a chat-only run must not ask for a recap"),
        ),
      ),
    ),
  );

  it.effect.each([
    { name: "a card in the run", cards: [{ runId: RUN, type: "child_plan_request" }], asks: false },
    {
      name: "a card in an earlier run",
      cards: [{ runId: RunId.make("run-earlier"), type: "child_plan_request" }],
      asks: true,
    },
    { name: "an unreadable run", cards: "unreadable" as const, asks: true },
  ])("asks only when no card already asks, after $name", ({ cards, asks }) =>
    Effect.gen(function* () {
      const hub = yield* TurnRecapHub.TurnRecapHub;
      yield* hub.recapAfterRun({ threadId: THREAD, runId: RUN });
      const first = yield* hub.subscribe(THREAD).pipe(Stream.runHead);
      expect(Option.map(first, (item) => item.recap)).toEqual(
        Option.some(
          asks
            ? {
                summary: "Parser fixed. Tests not run.",
                question: "Run the tests?",
                replies: ["Yes"],
              }
            : { summary: "Parser fixed. Tests not run.", replies: [] },
        ),
      );
    }).pipe(
      Effect.provide(hubWith(workRun, () => Effect.succeed(Option.some(RECAP_REPLY)), cards)),
    ),
  );

  it.effect("drops a recap that arrives after the next run started", () =>
    Effect.gen(function* () {
      const asked = yield* Deferred.make<void>();
      const answer = yield* Deferred.make<Option.Option<string>>();
      const program = Effect.gen(function* () {
        const hub = yield* TurnRecapHub.TurnRecapHub;
        const pending = yield* Effect.forkChild(
          hub.recapAfterRun({ threadId: THREAD, runId: RUN }),
        );
        yield* Deferred.await(asked);
        yield* hub.clear(THREAD);
        yield* Deferred.succeed(answer, Option.some(RECAP_REPLY));
        yield* Fiber.join(pending);
        return yield* hub.subscribe(THREAD).pipe(Stream.runHead);
      });
      const first = yield* program.pipe(
        Effect.provide(
          hubWith(workRun, () =>
            Deferred.succeed(asked, undefined).pipe(Effect.andThen(Deferred.await(answer))),
          ),
        ),
      );
      expect(Option.map(first, (item) => item.recap)).toEqual(Option.some(null));
    }),
  );
});
