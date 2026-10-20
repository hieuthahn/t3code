import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import type * as ProjectionStore from "./ProjectionStore.ts";

import { limitSwitchCommand } from "./UsageLimitSwitchWorker.ts";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");

const makeThread = (
  overrides: Partial<ProjectionStore.ProjectionLimitRecoveryCandidate> = {},
): ProjectionStore.ProjectionLimitRecoveryCandidate =>
  ({
    id: ThreadId.make("thread-1"),
    status: "failed",
    lastErrorClass: "usage_limit",
    latestRunId: RunId.make("run-1"),
    usageLimitResetAt: "2099-01-01T00:00:00.000Z",
    latestRunCompletedAt: null,
    updatedAt: null,
    archivedAt: null,
    settledOverride: null,
    pendingRuntimeRequest: null,
    limitRecovery: null,
    snoozedUntil: null,
    providerInstanceId: ProviderInstanceId.make("claude-a"),
    modelSelection: { instanceId: ProviderInstanceId.make("claude-a"), model: "claude-haiku-5-5" },
    ...overrides,
  }) as unknown as ProjectionStore.ProjectionLimitRecoveryCandidate;

describe("limitSwitchCommand", () => {
  it("continues the limited run on the target instance with the same model", () => {
    const command = limitSwitchCommand(makeThread(), ProviderInstanceId.make("claude-b"), NOW);
    assert.isNotNull(command);
    assert.equal(command?.type, "message.dispatch");
    if (command?.type !== "message.dispatch") return;
    assert.equal(command.manualContinuationOfRunId, RunId.make("run-1"));
    assert.deepEqual(command.modelSelection, {
      instanceId: ProviderInstanceId.make("claude-b"),
      model: "claude-haiku-5-5",
    });
    assert.deepEqual(command.dispatchMode, { type: "start_immediately" });
    assert.equal(
      command.commandId,
      `limit-switch:thread-1:run-1:claude-b:${Math.floor(NOW / 300_000)}`,
    );
    const later = limitSwitchCommand(
      makeThread(),
      ProviderInstanceId.make("claude-b"),
      NOW + 300_000,
    );
    assert.notEqual(later?.commandId, command.commandId);
  });

  it("returns nothing for threads that are not limited or cannot be resumed", () => {
    const target = ProviderInstanceId.make("claude-b");
    assert.isNull(
      limitSwitchCommand(makeThread({ lastErrorClass: "unknown" as never }), target, NOW),
    );
    assert.isNull(limitSwitchCommand(makeThread({ settledOverride: "settled" }), target, NOW));
    assert.isNull(limitSwitchCommand(makeThread({ latestRunId: null as never }), target, NOW));
  });
});
