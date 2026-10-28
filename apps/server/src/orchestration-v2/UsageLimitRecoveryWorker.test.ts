import { it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vite-plus/test";
import * as ServerSettings from "../serverSettings.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import { limitResetReleasesQueue, makeSweep } from "./UsageLimitRecoveryWorker.ts";

const failedAt = DateTime.makeUnsafe("2026-10-28T04:38:31.851Z");
const shell = {
  status: "failed" as const,
  lastErrorClass: "usage_limit" as const,
  usageLimitResetAt: "2026-10-28T07:10:00.000Z",
  latestRunCompletedAt: failedAt,
  updatedAt: failedAt,
  archivedAt: null,
  settledOverride: null,
  pendingRuntimeRequest: null,
  snoozedUntil: null,
};
const afterReset = Date.parse("2026-10-28T08:00:00.000Z");

describe("limitResetReleasesQueue", () => {
  it("waits for the limit's reset", () => {
    expect(limitResetReleasesQueue(shell, Date.parse("2026-10-28T07:09:59.000Z"))).toBe(false);
  });

  it("releases once the reset has passed", () => {
    expect(limitResetReleasesQueue(shell, Date.parse("2026-10-28T07:10:00.000Z"))).toBe(true);
  });

  it("keeps a window that had already expired when the run failed", () => {
    const expired = { ...shell, usageLimitResetAt: "2026-10-28T04:00:00.000Z" };
    expect(limitResetReleasesQueue(expired, afterReset)).toBe(false);
  });

  it("leaves a limit without a reset time and other failures alone", () => {
    expect(limitResetReleasesQueue({ ...shell, usageLimitResetAt: null }, afterReset)).toBe(false);
    expect(
      limitResetReleasesQueue({ ...shell, lastErrorClass: "provider_error" }, afterReset),
    ).toBe(false);
    expect(limitResetReleasesQueue({ ...shell, status: "idle" }, afterReset)).toBe(false);
    expect(limitResetReleasesQueue(null, afterReset)).toBe(false);
  });

  it("leaves a snoozed, settled, archived or asking thread alone", () => {
    const snoozed = { ...shell, snoozedUntil: DateTime.makeUnsafe("2026-10-28T09:00:00.000Z") };
    expect(limitResetReleasesQueue(snoozed, afterReset)).toBe(false);
    expect(limitResetReleasesQueue({ ...snoozed, snoozedUntil: failedAt }, afterReset)).toBe(true);
    expect(limitResetReleasesQueue({ ...shell, settledOverride: "settled" }, afterReset)).toBe(
      false,
    );
    expect(limitResetReleasesQueue({ ...shell, archivedAt: failedAt }, afterReset)).toBe(false);
    expect(
      limitResetReleasesQueue({ ...shell, pendingRuntimeRequest: {} as never }, afterReset),
    ).toBe(false);
  });
});

it.effect("starts only the queues whose limit has reset on each sweep", () =>
  Effect.gen(function* () {
    const released: Array<string> = [];
    const shells = new Map([
      [ThreadId.make("thread-reset"), shell],
      [
        ThreadId.make("thread-waiting"),
        { ...shell, usageLimitResetAt: "2026-10-28T09:00:00.000Z" },
      ],
    ]);
    const layer = Layer.mergeAll(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getLimitRecoveryCandidates: () => Effect.succeed([]),
        getRecoveryThreadIds: () => Effect.succeed([...shells.keys()]),
        getThreadShell: (threadId) => Effect.succeed((shells.get(threadId) ?? null) as never),
      }),
      Layer.mock(Orchestrator.OrchestratorV2)({
        releaseQueueAfterLimitReset: (threadId) =>
          Effect.sync(() => {
            released.push(threadId);
          }),
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({}),
      ServerSettings.layerTest(),
    );
    yield* TestClock.setTime(afterReset);
    const sweep = yield* makeSweep.pipe(Effect.provide(layer));
    yield* sweep().pipe(Effect.provide(layer));
    expect(released).toEqual(["thread-reset"]);
  }),
);
