import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { makeCoalescedCache } from "./CoalescedCache.ts";

it.effect("runs one computation for concurrent callers of the same key", () =>
  Effect.gen(function* () {
    const runs = yield* Ref.make(0);
    const gate = yield* Deferred.make<void>();
    const cached = makeCoalescedCache<number, never>({ ttlMillis: 1_000, maxEntries: 8 });
    const compute = Deferred.await(gate).pipe(
      Effect.andThen(Ref.updateAndGet(runs, (count) => count + 1)),
    );
    const first = yield* cached("a", compute).pipe(Effect.forkChild);
    const second = yield* cached("a", compute).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    yield* Deferred.succeed(gate, undefined);
    assert.deepEqual([yield* Fiber.join(first), yield* Fiber.join(second)], [1, 1]);
    assert.equal(yield* Ref.get(runs), 1);
  }),
);

it.effect("serves from cache until the TTL passes, then recomputes", () =>
  Effect.gen(function* () {
    const runs = yield* Ref.make(0);
    const cached = makeCoalescedCache<number, never>({ ttlMillis: 1_000, maxEntries: 8 });
    const compute = Ref.updateAndGet(runs, (count) => count + 1);
    assert.equal(yield* cached("a", compute), 1);
    yield* TestClock.adjust("999 millis");
    assert.equal(yield* cached("a", compute), 1);
    yield* TestClock.adjust("1 millis");
    assert.equal(yield* cached("a", compute), 2);
  }),
);

it.effect("evicts the oldest entry beyond the size bound", () =>
  Effect.gen(function* () {
    const runs = yield* Ref.make(0);
    const cached = makeCoalescedCache<number, never>({ ttlMillis: 10_000, maxEntries: 2 });
    const compute = Ref.updateAndGet(runs, (count) => count + 1);
    yield* cached("a", compute);
    yield* cached("b", compute);
    yield* cached("c", compute);
    assert.equal(yield* Ref.get(runs), 3);
    yield* cached("a", compute);
    assert.equal(yield* Ref.get(runs), 4);
  }),
);

it.effect("does not cache a failure and lets the next caller retry", () =>
  Effect.gen(function* () {
    const runs = yield* Ref.make(0);
    const cached = makeCoalescedCache<number, string>({ ttlMillis: 1_000, maxEntries: 8 });
    const flaky = Ref.updateAndGet(runs, (count) => count + 1).pipe(
      Effect.flatMap((count) => (count === 1 ? Effect.fail("boom") : Effect.succeed(count))),
    );
    assert.equal(yield* cached("a", flaky).pipe(Effect.flip), "boom");
    assert.equal(yield* cached("a", flaky), 2);
  }),
);
