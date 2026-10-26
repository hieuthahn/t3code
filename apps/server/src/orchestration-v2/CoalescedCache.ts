import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

/**
 * Keyed cache with a short TTL that runs one computation per key at a time.
 * Callers that arrive while a computation is in flight wait for its result.
 */
export const makeCoalescedCache = <A, E>(options: {
  readonly ttlMillis: number;
  readonly maxEntries: number;
}) => {
  const settled = new Map<string, { readonly at: number; readonly value: A }>();
  const inflight = new Map<string, Deferred.Deferred<A, E>>();

  const remember = (key: string, at: number, value: A) => {
    for (const [known, entry] of settled) {
      if (at - entry.at >= options.ttlMillis) settled.delete(known);
    }
    settled.delete(key);
    settled.set(key, { at, value });
    for (const known of settled.keys()) {
      if (settled.size <= options.maxEntries) break;
      settled.delete(known);
    }
  };

  return <R>(key: string, compute: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const hit = settled.get(key);
      if (hit !== undefined && now - hit.at < options.ttlMillis) return hit.value;
      const pending = inflight.get(key);
      if (pending !== undefined) return yield* Deferred.await(pending);
      const deferred = yield* Deferred.make<A, E>();
      inflight.set(key, deferred);
      return yield* compute.pipe(
        Effect.tap((value) => Effect.sync(() => remember(key, now, value))),
        Effect.onExit((exit) =>
          Effect.sync(() => inflight.delete(key)).pipe(
            Effect.andThen(Deferred.done(deferred, exit)),
          ),
        ),
      );
    });
};
