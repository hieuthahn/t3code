import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationV2Command,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2TurnItem,
  ProviderInstanceId,
  RunId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AccountSwitchJournal from "./AccountSwitchJournal.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

import {
  atTurnBoundary,
  emptyMidTurnSwitchState,
  makeSweep,
  midTurnSwitchCandidates,
  type PendingMidTurnSwitch,
  pendingSwitchStep,
  planMidTurnSwitch,
} from "./MidTurnAccountSwitchWorker.ts";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const personal = ProviderInstanceId.make("claude-a");
const work = ProviderInstanceId.make("claude-b");
const runId = RunId.make("run-1");
const threadId = ThreadId.make("thread-1");

const account = (instanceId: ProviderInstanceId, usedPercent: number): ServerProvider =>
  ({
    instanceId,
    displayName: instanceId === personal ? "Personal" : "Work",
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
          label: "5-hour",
          usedPercent,
          resetsAt: "2026-10-20T14:00:00.000Z",
        },
      ],
    },
  }) as unknown as ServerProvider;

const makeShell = (
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell =>
  ({
    id: threadId,
    providerInstanceId: personal,
    modelSelection: { instanceId: personal, model: "claude-haiku-5-5" },
    activeRunId: runId,
    activityRunStatus: "running",
    archivedAt: null,
    deletedAt: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunStopRequested: false,
    ...overrides,
  }) as unknown as OrchestrationV2ThreadShell;

const makeRun = (overrides: Partial<OrchestrationV2Run> = {}): OrchestrationV2Run =>
  ({ id: runId, ordinal: 1, status: "running", ...overrides }) as unknown as OrchestrationV2Run;

const openItem = (status: OrchestrationV2TurnItem["status"]): OrchestrationV2TurnItem =>
  ({ runId, status, type: "command_execution" }) as unknown as OrchestrationV2TurnItem;

const pending: PendingMidTurnSwitch = {
  threadId,
  runId,
  note: { from: personal, to: work, reason: "mid-turn" },
  reason: "Moving this turn to Work before the usage limit",
  requestedAtMs: NOW,
};

const interruptRequest = (message: string): OrchestrationV2TurnItem =>
  ({ runId, type: "run_interrupt_request", message }) as unknown as OrchestrationV2TurnItem;

describe("midTurnSwitchCandidates", () => {
  it("keeps running threads and leaves out pinned, waiting and recently switched ones", () => {
    const candidates = midTurnSwitchCandidates({
      threads: [
        makeShell(),
        makeShell({
          id: ThreadId.make("pinned"),
          modelSelection: { instanceId: personal, model: "m", accountChoice: "pinned" },
        }),
        makeShell({
          id: ThreadId.make("asking"),
          pendingRuntimeRequest: {} as OrchestrationV2ThreadShell["pendingRuntimeRequest"],
        }),
        makeShell({ id: ThreadId.make("idle"), activityRunStatus: "waiting" }),
        makeShell({ id: ThreadId.make("recent") }),
      ],
      switchPinned: false,
      state: {
        ...emptyMidTurnSwitchState,
        lastSwitchAtMs: new Map([[ThreadId.make("recent"), NOW - 60_000]]),
      },
      nowMs: NOW,
    });
    assert.deepEqual(
      candidates.map((thread) => thread.id),
      [threadId],
    );
  });
});

describe("atTurnBoundary", () => {
  it("waits while a tool or streamed message is open", () => {
    assert.isFalse(atTurnBoundary({ runId, runs: [makeRun()], openItems: [openItem("running")] }));
    assert.isTrue(atTurnBoundary({ runId, runs: [makeRun()], openItems: [] }));
  });

  it("leaves a turn alone while a message waits in the queue behind it", () => {
    assert.isFalse(
      atTurnBoundary({
        runId,
        runs: [makeRun(), makeRun({ id: RunId.make("run-2"), ordinal: 2, status: "queued" })],
        openItems: [],
      }),
    );
  });
});

describe("planMidTurnSwitch", () => {
  const thresholdsFor = () => ({ sessionPercent: 90, weeklyPercent: 90 });

  it("moves a pressured account to a peer with headroom and names the window", () => {
    const note = planMidTurnSwitch({
      thread: makeShell(),
      providers: [account(personal, 93), account(work, 20)],
      thresholdsFor,
      nowMs: NOW,
    });
    assert.deepEqual(note, {
      from: personal,
      to: work,
      reason: "mid-turn",
      pressure: { windowLabel: "5-hour", usedPercent: 93 },
    });
  });

  it("stays when the account is under threshold or no peer has headroom", () => {
    const stay = (personalPercent: number, workPercent: number) =>
      planMidTurnSwitch({
        thread: makeShell(),
        providers: [account(personal, personalPercent), account(work, workPercent)],
        thresholdsFor,
        nowMs: NOW,
      });
    assert.isUndefined(stay(80, 10));
    assert.isUndefined(stay(93, 75));
  });
});

describe("pendingSwitchStep", () => {
  it("continues once the run reads interrupted", () => {
    assert.equal(
      pendingSwitchStep({
        pending,
        interruptRequests: [],
        runs: [makeRun({ status: "interrupted" })],
        nowMs: NOW,
      }),
      "continue",
    );
  });

  it("waits for the interrupt, then gives up after two minutes", () => {
    assert.equal(
      pendingSwitchStep({ pending, interruptRequests: [], runs: [makeRun()], nowMs: NOW + 5_000 }),
      "wait",
    );
    assert.equal(
      pendingSwitchStep({
        pending,
        interruptRequests: [],
        runs: [makeRun()],
        nowMs: NOW + 121_000,
      }),
      "drop",
    );
  });

  it("drops the switch when the user stopped the turn too", () => {
    const runs = [makeRun({ status: "interrupted" })];
    assert.equal(
      pendingSwitchStep({
        pending,
        runs,
        interruptRequests: [interruptRequest(pending.reason)],
        nowMs: NOW,
      }),
      "continue",
    );
    assert.equal(
      pendingSwitchStep({
        pending,
        runs,
        interruptRequests: [interruptRequest("Interrupt requested")],
        nowMs: NOW,
      }),
      "drop",
    );
  });

  it("drops the switch when the run finished or the user sent something newer", () => {
    assert.equal(
      pendingSwitchStep({
        pending,
        interruptRequests: [],
        runs: [makeRun({ status: "completed" })],
        nowMs: NOW,
      }),
      "drop",
    );
    assert.equal(
      pendingSwitchStep({
        pending,
        interruptRequests: [],
        runs: [
          makeRun({ status: "interrupted" }),
          makeRun({ id: RunId.make("run-2"), ordinal: 2, status: "running" }),
        ],
        nowMs: NOW,
      }),
      "drop",
    );
  });
});

const runSweeps = (input: {
  readonly earlyAccountSwitch: boolean;
  readonly openItems?: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly peerPercent?: number;
}) =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2Command> = [];
    let snapshots = 0;
    let runStatus: OrchestrationV2Run["status"] = "running";
    const projections = Layer.succeed(ProjectionStore.ProjectionStoreV2, {
      getShellSnapshot: () =>
        Effect.sync(() => {
          snapshots += 1;
          return { threads: [makeShell()], archivedThreads: [] };
        }),
      getThreadRecords: () =>
        Effect.succeed({
          thread: makeShell(),
          runs: [makeRun({ status: runStatus })],
          turnItems: input.openItems ?? [],
        }),
    } as unknown as ProjectionStore.ProjectionStoreV2["Service"]);
    const threads = Layer.succeed(ThreadManagement.ThreadManagementService, {
      dispatch: (command: OrchestrationV2Command) =>
        Effect.sync(() => {
          dispatched.push(command);
          if (command.type === "run.interrupt") runStatus = "interrupted";
        }),
    } as unknown as ThreadManagement.ThreadManagementService["Service"]);
    yield* TestClock.setTime(NOW);
    const journalLayer = AccountSwitchJournal.layer;
    const program = Effect.gen(function* () {
      const sweep = yield* makeSweep;
      yield* sweep();
      yield* TestClock.adjust("5 seconds");
      yield* sweep();
      const journal = yield* AccountSwitchJournal.AccountSwitchJournal;
      return yield* journal.take(threadId, work);
    });
    const note = yield* program.pipe(
      Effect.provide(
        Layer.mergeAll(
          ProviderRegistryMock.layer([
            account(personal, 93),
            account(work, input.peerPercent ?? 20),
          ]),
          projections,
          threads,
          journalLayer,
          ServerSettings.layerTest({ earlyAccountSwitch: input.earlyAccountSwitch }),
        ),
      ),
    );
    return { dispatched, note, snapshots };
  });

describe("mid-turn account switch sweep", () => {
  it.effect("interrupts at a boundary, then continues the turn on the roomier account", () =>
    Effect.gen(function* () {
      const result = yield* runSweeps({ earlyAccountSwitch: true });
      assert.deepEqual(
        result.dispatched.map((command) => command.type),
        ["run.interrupt", "message.dispatch"],
      );
      const continuation = result.dispatched[1];
      assert.equal(
        continuation?.type === "message.dispatch" ? continuation.modelSelection?.instanceId : null,
        work,
      );
      assert.equal(
        continuation?.type === "message.dispatch" ? continuation.manualContinuationOfRunId : null,
        runId,
      );
      assert.equal(Option.getOrUndefined(result.note)?.reason, "mid-turn");
    }),
  );

  it.effect("does nothing while the setting is off", () =>
    Effect.gen(function* () {
      const result = yield* runSweeps({ earlyAccountSwitch: false });
      assert.deepEqual(result.dispatched, []);
    }),
  );

  it.effect("leaves a turn alone while a tool call is still running", () =>
    Effect.gen(function* () {
      const result = yield* runSweeps({
        earlyAccountSwitch: true,
        openItems: [openItem("running")],
      });
      assert.deepEqual(result.dispatched, []);
    }),
  );

  it.effect("skips reading threads while no peer has headroom", () =>
    Effect.gen(function* () {
      const result = yield* runSweeps({ earlyAccountSwitch: true, peerPercent: 75 });
      assert.deepEqual(result.dispatched, []);
      assert.equal(result.snapshots, 0);
    }),
  );
});
