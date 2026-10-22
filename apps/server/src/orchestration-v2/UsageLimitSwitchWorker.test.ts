import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationV2Command,
  ProviderInstanceId,
  RunId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

import {
  emptyLimitSwitchLedger,
  instancesDueForRefresh,
  limitSwitchCommand,
  makeSweep,
  recentAssignmentCounts,
  recordLimitSwitch,
  recordRefreshes,
  threadMaySwitch,
} from "./UsageLimitSwitchWorker.ts";

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
    assert.isNull(
      limitSwitchCommand(
        makeThread({ snoozedUntil: DateTime.makeUnsafe(NOW + 60_000) }),
        target,
        NOW,
      ),
    );
    assert.isNotNull(
      limitSwitchCommand(makeThread({ snoozedUntil: DateTime.makeUnsafe(NOW - 60_000) }), target, NOW),
    );
    assert.isNull(
      limitSwitchCommand(makeThread({ usageLimitResetAt: "2026-10-20T11:00:00.000Z" }), target, NOW),
    );
  });
});

describe("limit switch ledger", () => {
  const claudeB = ProviderInstanceId.make("claude-b");
  const claudeC = ProviderInstanceId.make("claude-c");
  const thread1 = ThreadId.make("thread-1");
  const thread2 = ThreadId.make("thread-2");

  it("counts only assignments from the last ten minutes", () => {
    let ledger = recordLimitSwitch(emptyLimitSwitchLedger, { instanceId: claudeB, threadId: thread1 }, NOW);
    ledger = recordLimitSwitch(ledger, { instanceId: claudeB, threadId: thread2 }, NOW + 60_000);
    ledger = recordLimitSwitch(ledger, { instanceId: claudeC, threadId: thread1 }, NOW + 120_000);
    assert.deepEqual([...recentAssignmentCounts(ledger, NOW + 120_000)], [
      [claudeB, 2],
      [claudeC, 1],
    ]);
    assert.deepEqual([...recentAssignmentCounts(ledger, NOW + 10 * 60_000 + 30_000)], [
      [claudeB, 1],
      [claudeC, 1],
    ]);
  });

  it("caps a thread at three switches an hour", () => {
    let ledger = emptyLimitSwitchLedger;
    for (const offsetMinutes of [0, 5, 10]) {
      assert.isTrue(threadMaySwitch(ledger, thread1, NOW + offsetMinutes * 60_000));
      ledger = recordLimitSwitch(
        ledger,
        { instanceId: claudeB, threadId: thread1 },
        NOW + offsetMinutes * 60_000,
      );
    }
    assert.isFalse(threadMaySwitch(ledger, thread1, NOW + 20 * 60_000));
    assert.isTrue(threadMaySwitch(ledger, thread2, NOW + 20 * 60_000));
    assert.isTrue(threadMaySwitch(ledger, thread1, NOW + 61 * 60_000));
  });

  it("refreshes each peer at most once a minute", () => {
    assert.deepEqual(instancesDueForRefresh(emptyLimitSwitchLedger, [claudeB, claudeB, claudeC], NOW), [
      claudeB,
      claudeC,
    ]);
    const ledger = recordRefreshes(emptyLimitSwitchLedger, [claudeB], NOW);
    assert.deepEqual(instancesDueForRefresh(ledger, [claudeB, claudeC], NOW + 30_000), [claudeC]);
    assert.deepEqual(instancesDueForRefresh(ledger, [claudeB], NOW + 60_000), [claudeB]);
  });
});

const peer = (instanceId: string, usedPercent: number): ServerProvider =>
  ({
    instanceId: ProviderInstanceId.make(instanceId),
    driver: "claudeAgent",
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    models: [{ slug: "claude-haiku-5-5", name: "Haiku", isCustom: false }],
    continuation: { groupKey: "claude:home:/shared" },
    usageLimits: {
      checkedAt: "2026-10-20T12:00:00.000Z",
      windows: [
        {
          id: "five_hour",
          kind: "session",
          label: "Session",
          usedPercent,
          resetsAt: "2026-10-20T14:00:00.000Z",
        },
      ],
    },
  }) as unknown as ServerProvider;

const runSweeps = (input: {
  readonly mode: "off" | "ask" | "auto";
  readonly threads: ReadonlyArray<ProjectionStore.ProjectionLimitRecoveryCandidate>;
  readonly sweeps: number;
}) =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2Command> = [];
    const refreshed: Array<ProviderInstanceId> = [];
    const providers = [peer("claude-a", 100), peer("claude-b", 25), peer("claude-c", 20)];
    const registry = Layer.effect(
      ProviderRegistry.ProviderRegistry,
      Effect.map(
        Effect.service(ProviderRegistry.ProviderRegistry),
        (base): ProviderRegistry.ProviderRegistry["Service"] => ({
          ...base,
          refreshInstance: (instanceId) =>
            Effect.sync(() => {
              refreshed.push(instanceId);
              return providers;
            }),
        }),
      ),
    ).pipe(Layer.provide(ProviderRegistryMock.layer(providers)));
    const projections = Layer.succeed(ProjectionStore.ProjectionStoreV2, {
      getLimitRecoveryCandidates: () => Effect.succeed(input.threads),
    } as unknown as ProjectionStore.ProjectionStoreV2["Service"]);
    const threads = Layer.succeed(ThreadManagement.ThreadManagementService, {
      dispatch: (command: OrchestrationV2Command) =>
        Effect.sync(() => {
          dispatched.push(command);
        }),
    } as unknown as ThreadManagement.ThreadManagementService["Service"]);
    yield* TestClock.setTime(NOW);
    const sweep = yield* makeSweep.pipe(
      Effect.provide(
        Layer.mergeAll(
          registry,
          projections,
          threads,
          ServerSettings.layerTest({ limitedThreadSwitch: input.mode }),
        ),
      ),
    );
    for (let index = 0; index < input.sweeps; index += 1) {
      if (index > 0) yield* TestClock.adjust("10 seconds");
      yield* sweep();
    }
    return { dispatched, refreshed };
  });

describe("usage limit switch sweep", () => {
  it.effect("does nothing unless the mode is auto", () =>
    Effect.gen(function* () {
      const result = yield* runSweeps({ mode: "ask", threads: [makeThread()], sweeps: 1 });
      assert.deepEqual(result.dispatched, []);
      assert.deepEqual(result.refreshed, []);
    }),
  );

  it.effect("moves the thread to the peer with the most headroom", () =>
    Effect.gen(function* () {
      const result = yield* runSweeps({ mode: "auto", threads: [makeThread()], sweeps: 1 });
      assert.deepEqual(
        result.dispatched.map((command) =>
          command.type === "message.dispatch" ? command.modelSelection?.instanceId : null,
        ),
        [ProviderInstanceId.make("claude-c")],
      );
      assert.sameMembers(result.refreshed, [
        ProviderInstanceId.make("claude-b"),
        ProviderInstanceId.make("claude-c"),
      ]);
    }),
  );

  it.effect("spreads threads and refreshes peers once a minute across sweeps", () =>
    Effect.gen(function* () {
      const result = yield* runSweeps({
        mode: "auto",
        threads: [
          makeThread(),
          makeThread({ id: ThreadId.make("thread-2"), latestRunId: RunId.make("run-2") }),
        ],
        sweeps: 2,
      });
      const targets = result.dispatched.map((command) =>
        command.type === "message.dispatch"
          ? `${command.threadId}>${command.modelSelection?.instanceId}`
          : "",
      );
      assert.deepEqual(targets.slice(0, 2), ["thread-1>claude-c", "thread-2>claude-b"]);
      assert.equal(result.refreshed.length, 2);
    }),
  );
});
