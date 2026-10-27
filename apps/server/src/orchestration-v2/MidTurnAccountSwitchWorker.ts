import {
  CommandId,
  MessageId,
  type OrchestrationV2Command,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2TurnItem,
  type ProviderInstanceId,
  type RunId,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import {
  type AccountSwitchThresholds,
  chooseAccountForTurn,
  resolveAccountSwitchThresholds,
} from "@t3tools/shared/usageLimitSwitchCandidates";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AccountSwitchJournal from "./AccountSwitchJournal.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const SCAN_INTERVAL_MS = 10_000;
const THREAD_COOLDOWN_MS = 30 * 60_000;
const PENDING_TIMEOUT_MS = 2 * 60_000;
const MAX_THREADS_PER_SCAN = 10;
const OPEN_ITEM_STATUSES = ["pending", "running", "waiting"] as const;

export interface PendingMidTurnSwitch {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly note: AccountSwitchJournal.AccountSwitchNote;
  /** The interrupt reason this worker sent, which tells its interrupt apart from a user's Stop. */
  readonly reason: string;
  readonly requestedAtMs: number;
}

export interface MidTurnSwitchState {
  readonly pending: ReadonlyMap<ThreadId, PendingMidTurnSwitch>;
  readonly lastSwitchAtMs: ReadonlyMap<ThreadId, number>;
  readonly lastScanAtMs: number | undefined;
}

export const emptyMidTurnSwitchState: MidTurnSwitchState = {
  pending: new Map(),
  lastSwitchAtMs: new Map(),
  lastScanAtMs: undefined,
};

/** Pick the running threads whose turn may move to another account between tool calls. */
export const midTurnSwitchCandidates = (input: {
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly switchPinned: boolean;
  readonly state: MidTurnSwitchState;
  readonly nowMs: number;
}): ReadonlyArray<OrchestrationV2ThreadShell> =>
  input.threads.filter((thread) => {
    const lastSwitchAtMs = input.state.lastSwitchAtMs.get(thread.id);
    return (
      thread.activeRunId !== null &&
      thread.activityRunStatus === "running" &&
      thread.archivedAt === null &&
      thread.deletedAt === null &&
      thread.pendingRuntimeRequest === null &&
      (thread.pendingBackgroundTasks ?? []).length === 0 &&
      thread.latestRunStopRequested !== true &&
      (input.switchPinned || thread.modelSelection.accountChoice !== "pinned") &&
      !input.state.pending.has(thread.id) &&
      (lastSwitchAtMs === undefined || input.nowMs - lastSwitchAtMs >= THREAD_COOLDOWN_MS)
    );
  });

/**
 * Tell whether a running turn sits between steps: no tool, subagent or streamed
 * message is open, and nothing waits in the queue behind it.
 */
export const atTurnBoundary = (input: {
  readonly runId: RunId;
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
  readonly openItems: ReadonlyArray<OrchestrationV2TurnItem>;
}): boolean => {
  const run = input.runs.find((candidate) => candidate.id === input.runId);
  return (
    run !== undefined &&
    run.status === "running" &&
    !input.runs.some((candidate) => candidate.status === "queued") &&
    !input.openItems.some(
      (item) =>
        item.runId === input.runId &&
        (OPEN_ITEM_STATUSES as ReadonlyArray<string>).includes(item.status),
    )
  );
};

/** Choose the account a running turn moves to, or none while its account is under threshold. */
export const planMidTurnSwitch = (input: {
  readonly thread: OrchestrationV2ThreadShell;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly thresholdsFor: (instanceId: ProviderInstanceId) => AccountSwitchThresholds;
  readonly nowMs: number;
  /** Targets this scan already picked, so threads leaving one account spread across peers. */
  readonly recentAssignments?: ReadonlyMap<ProviderInstanceId, number>;
}): AccountSwitchJournal.AccountSwitchNote | undefined => {
  const choice = chooseAccountForTurn({
    providers: input.providers,
    currentInstanceId: input.thread.providerInstanceId,
    model: input.thread.modelSelection.model,
    nowMs: input.nowMs,
    thresholdsFor: input.thresholdsFor,
    ...(input.recentAssignments === undefined
      ? {}
      : { recentAssignments: input.recentAssignments }),
  });
  if (!choice.switched || choice.reason !== "near-limit") return undefined;
  const pressure = AccountSwitchJournal.notePressure(
    input.providers,
    input.thread.providerInstanceId,
    choice.pressure,
  );
  return {
    from: input.thread.providerInstanceId,
    to: choice.instanceId,
    reason: "mid-turn",
    ...(pressure === undefined ? {} : { pressure }),
  };
};

const midTurnInterruptReason = (toName: string): string =>
  `Moving this turn to ${toName} before the usage limit`;

const midTurnInterruptCommand = (pending: PendingMidTurnSwitch): OrchestrationV2Command => ({
  type: "run.interrupt",
  commandId: CommandId.make(`mid-turn-switch:interrupt:${pending.runId}`),
  threadId: pending.threadId,
  runId: pending.runId,
  reason: pending.reason,
});

/** Decide what a requested switch does next, given the interrupted run's latest state. */
export const pendingSwitchStep = (input: {
  readonly pending: PendingMidTurnSwitch;
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
  readonly interruptRequests: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly nowMs: number;
}): "continue" | "wait" | "drop" => {
  const run = input.runs.find((candidate) => candidate.id === input.pending.runId);
  if (run === undefined) return "drop";
  const stoppedByOther = input.interruptRequests.some(
    (item) =>
      item.runId === input.pending.runId &&
      item.type === "run_interrupt_request" &&
      item.message !== input.pending.reason,
  );
  if (stoppedByOther) return "drop";
  const newer = input.runs.some(
    (candidate) => candidate.ordinal > run.ordinal && candidate.status !== "cancelled",
  );
  if (newer) return "drop";
  if (run.status === "interrupted") return "continue";
  if (run.status === "running" || run.status === "waiting" || run.status === "starting") {
    return input.nowMs - input.pending.requestedAtMs < PENDING_TIMEOUT_MS ? "wait" : "drop";
  }
  return "drop";
};

const midTurnContinuationCommand = (
  thread: Pick<OrchestrationV2ThreadShell, "id" | "modelSelection">,
  pending: PendingMidTurnSwitch,
): OrchestrationV2Command => ({
  type: "message.dispatch",
  commandId: CommandId.make(`mid-turn-switch:continue:${pending.runId}`),
  messageId: MessageId.make(`mid-turn-switch:continue:${pending.runId}`),
  threadId: thread.id,
  manualContinuationOfRunId: pending.runId,
  modelSelection: { ...thread.modelSelection, instanceId: pending.note.to },
  text: "Continue where you left off.",
  attachments: [],
  dispatchMode: { type: "start_immediately" },
  createdBy: "user",
  creationSource: "server",
});

export const makeSweep = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const registry = yield* ProviderRegistry.ProviderRegistry;
  const journal = yield* Effect.serviceOption(AccountSwitchJournal.AccountSwitchJournal);
  const stateRef = yield* Ref.make(emptyMidTurnSwitchState);

  const nameOf = (providers: ReadonlyArray<ServerProvider>, instanceId: ProviderInstanceId) =>
    providers.find((provider) => provider.instanceId === instanceId)?.displayName ?? instanceId;

  const advancePending = Effect.fn("MidTurnAccountSwitchWorker.advancePending")(function* (
    pending: PendingMidTurnSwitch,
    nowMs: number,
  ) {
    const records = yield* projections.getThreadRecords(pending.threadId, ["runs", "turnItems"], {
      turnItemRunId: pending.runId,
      turnItemTypes: ["run_interrupt_request"],
    });
    const step = pendingSwitchStep({
      pending,
      runs: records.runs,
      interruptRequests: records.turnItems,
      nowMs,
    });
    if (step === "wait") return;
    yield* Ref.update(stateRef, (state) => {
      const next = new Map(state.pending);
      next.delete(pending.threadId);
      return { ...state, pending: next };
    });
    if (step === "drop") {
      yield* Effect.logInfo("orchestration-v2.mid-turn-switch.dropped", {
        threadId: pending.threadId,
        runId: pending.runId,
      });
      return;
    }
    if (Option.isSome(journal)) yield* journal.value.record(pending.threadId, pending.note);
    yield* threads
      .dispatch(midTurnContinuationCommand(records.thread, pending))
      .pipe(
        Effect.tapError(() =>
          Option.isSome(journal)
            ? journal.value.take(pending.threadId, pending.note.to)
            : Effect.void,
        ),
      );
    yield* Effect.logInfo("orchestration-v2.mid-turn-switch.continued", {
      threadId: pending.threadId,
      runId: pending.runId,
      from: pending.note.from,
      to: pending.note.to,
    });
  });

  const requestSwitch = Effect.fn("MidTurnAccountSwitchWorker.requestSwitch")(function* (
    thread: OrchestrationV2ThreadShell,
    note: AccountSwitchJournal.AccountSwitchNote,
    providers: ReadonlyArray<ServerProvider>,
    nowMs: number,
  ) {
    const runId = thread.activeRunId;
    if (runId === null) return false;
    const records = yield* projections.getThreadRecords(thread.id, ["runs", "turnItems"], {
      turnItemRunId: runId,
      turnItemStatuses: OPEN_ITEM_STATUSES,
    });
    if (!atTurnBoundary({ runId, runs: records.runs, openItems: records.turnItems })) return false;
    const pending: PendingMidTurnSwitch = {
      threadId: thread.id,
      runId,
      note,
      reason: midTurnInterruptReason(nameOf(providers, note.to)),
      requestedAtMs: nowMs,
    };
    yield* threads.dispatch(midTurnInterruptCommand(pending));
    yield* Ref.update(stateRef, (state) => ({
      ...state,
      pending: new Map(state.pending).set(thread.id, pending),
      lastSwitchAtMs: new Map(state.lastSwitchAtMs).set(thread.id, nowMs),
    }));
    yield* Effect.logInfo("orchestration-v2.mid-turn-switch.interrupted", {
      threadId: thread.id,
      runId,
      from: note.from,
      to: note.to,
      ...note.pressure,
    });
    return true;
  });

  return Effect.fn("MidTurnAccountSwitchWorker.sweep")(function* () {
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    for (const pending of (yield* Ref.get(stateRef)).pending.values()) {
      yield* advancePending(pending, nowMs).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration-v2.mid-turn-switch.continue-failed", {
            threadId: pending.threadId,
            cause,
          }),
        ),
      );
    }

    const preferences = yield* settings.getSettings;
    if (!preferences.earlyAccountSwitch) return;
    const state = yield* Ref.get(stateRef);
    if (state.lastScanAtMs !== undefined && nowMs - state.lastScanAtMs < SCAN_INTERVAL_MS) return;
    yield* Ref.update(stateRef, (current) => ({ ...current, lastScanAtMs: nowMs }));

    const providers = yield* registry.getProviders;
    const thresholdsFor = resolveAccountSwitchThresholds({
      defaults: {
        sessionPercent: preferences.earlySwitchSessionThreshold,
        weeklyPercent: preferences.earlySwitchWeeklyThreshold,
      },
      instances: preferences.providerInstances,
    });
    const pressuredInstances = new Set(
      providers
        .filter((provider) => {
          const choice = chooseAccountForTurn({
            providers,
            currentInstanceId: provider.instanceId,
            model: undefined,
            nowMs,
            thresholdsFor,
          });
          return choice.reason === "near-limit";
        })
        .map((provider) => provider.instanceId),
    );
    if (pressuredInstances.size === 0) return;

    const snapshot = yield* projections.getShellSnapshot({
      location: "active",
      unsettledOnly: true,
    });
    const candidates = midTurnSwitchCandidates({
      threads: snapshot.threads.filter((thread) =>
        pressuredInstances.has(thread.providerInstanceId),
      ),
      switchPinned: preferences.switchPinnedAccounts,
      state: yield* Ref.get(stateRef),
      nowMs,
    });
    const assigned = new Map<ProviderInstanceId, number>();
    for (const thread of candidates.slice(0, MAX_THREADS_PER_SCAN)) {
      const note = planMidTurnSwitch({
        thread,
        providers,
        thresholdsFor,
        nowMs,
        recentAssignments: assigned,
      });
      if (note === undefined) continue;
      const requested = yield* requestSwitch(thread, note, providers, nowMs).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration-v2.mid-turn-switch.interrupt-failed", {
            threadId: thread.id,
            cause,
          }).pipe(Effect.as(false)),
        ),
      );
      if (requested) assigned.set(note.to, (assigned.get(note.to) ?? 0) + 1);
    }
  });
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sweep = yield* makeSweep;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("mid-turn-account-switch", sweep());
  }),
);
