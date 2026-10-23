import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import { makeRun } from "./ClaudeDesktopSyncRun.ts";

const unused = Effect.die("not called");

describe("makeRun", () => {
  it.effect("fails a preview that runs past the limit with a clear reason", () =>
    Effect.gen(function* () {
      const run = makeRun({ preview: Effect.never, apply: () => unused, undoLast: unused });
      const fiber = yield* run({ action: "preview" }).pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust("61 seconds");
      const error = yield* Fiber.join(fiber);
      expect(error.reason).toContain("took longer than 60 seconds");
    }),
  );

  it.effect("lets apply run past the preview limit", () =>
    Effect.gen(function* () {
      const result = { runId: "r", applied: 1, queuedForDesktop: 0, failed: [] };
      const run = makeRun({
        preview: unused,
        apply: () => Effect.sleep("90 seconds").pipe(Effect.as(result)),
        undoLast: unused,
      });
      const fiber = yield* run({ action: "apply" }).pipe(Effect.forkChild);
      yield* TestClock.adjust("91 seconds");
      expect(yield* Fiber.join(fiber)).toEqual({ apply: result });
    }),
  );
});
