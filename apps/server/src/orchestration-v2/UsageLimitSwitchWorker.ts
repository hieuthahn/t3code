import {
  CommandId,
  MessageId,
  type OrchestrationV2Command,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import { rankUsageLimitSwitchCandidates } from "@t3tools/shared/usageLimitSwitchCandidates";

const REFRESH_TIMEOUT = "5 seconds";
const RETRY_BUCKET_MS = 5 * 60_000;
const REFRESH_INTERVAL_MS = 60_000;
const ASSIGNMENT_WINDOW_MS = 10 * 60_000;
const THREAD_SWITCH_WINDOW_MS = 60 * 60_000;
const MAX_THREAD_SWITCHES_PER_WINDOW = 3;

export interface LimitSwitchLedger {
  readonly assignments: ReadonlyArray<{
    readonly instanceId: ProviderInstanceId;
    readonly threadId: ThreadId;
    readonly atMs: number;
  }>;
  readonly refreshedAtMs: ReadonlyMap<ProviderInstanceId, number>;
}

export const emptyLimitSwitchLedger: LimitSwitchLedger = {
  assignments: [],
  refreshedAtMs: new Map(),
};

/** Count the threads each instance took over recently, so the next switch spreads load. */
export const recentAssignmentCounts = (
  ledger: LimitSwitchLedger,
  nowMs: number,
): ReadonlyMap<ProviderInstanceId, number> => {
  const counts = new Map<ProviderInstanceId, number>();
  for (const assignment of ledger.assignments) {
    if (nowMs - assignment.atMs >= ASSIGNMENT_WINDOW_MS) continue;
    counts.set(assignment.instanceId, (counts.get(assignment.instanceId) ?? 0) + 1);
  }
  return counts;
};

/** Stop a thread that keeps hitting limits from bouncing between accounts. */
export const threadMaySwitch = (
  ledger: LimitSwitchLedger,
  threadId: ThreadId,
  nowMs: number,
): boolean =>
  ledger.assignments.filter(
    (assignment) =>
      assignment.threadId === threadId && nowMs - assignment.atMs < THREAD_SWITCH_WINDOW_MS,
  ).length < MAX_THREAD_SWITCHES_PER_WINDOW;

export const recordLimitSwitch = (
  ledger: LimitSwitchLedger,
  input: { readonly instanceId: ProviderInstanceId; readonly threadId: ThreadId },
  nowMs: number,
): LimitSwitchLedger => ({
  ...ledger,
  assignments: [
    ...ledger.assignments.filter(
      (assignment) =>
        nowMs - assignment.atMs < Math.max(ASSIGNMENT_WINDOW_MS, THREAD_SWITCH_WINDOW_MS),
    ),
    { ...input, atMs: nowMs },
  ],
});

/** Pick the peers whose usage reading is older than the refresh interval. */
export const instancesDueForRefresh = (
  ledger: LimitSwitchLedger,
  instanceIds: Iterable<ProviderInstanceId>,
  nowMs: number,
): ReadonlyArray<ProviderInstanceId> =>
  [...new Set(instanceIds)].filter(
    (instanceId) => nowMs - (ledger.refreshedAtMs.get(instanceId) ?? 0) >= REFRESH_INTERVAL_MS,
  );

export const recordRefreshes = (
  ledger: LimitSwitchLedger,
  instanceIds: ReadonlyArray<ProviderInstanceId>,
  nowMs: number,
): LimitSwitchLedger => {
  const refreshedAtMs = new Map(ledger.refreshedAtMs);
  for (const instanceId of instanceIds) refreshedAtMs.set(instanceId, nowMs);
  return { ...ledger, refreshedAtMs };
};

const isSwitchable = (
  thread: ProjectionStore.ProjectionLimitRecoveryCandidate,
  nowMs: number,
): boolean =>
  thread.status === "failed" &&
  thread.lastErrorClass === "usage_limit" &&
  Boolean(thread.latestRunId) &&
  Boolean(thread.usageLimitResetAt) &&
  Date.parse(thread.usageLimitResetAt!) > nowMs &&
  (thread.snoozedUntil == null || DateTime.toEpochMillis(thread.snoozedUntil) <= nowMs) &&
  thread.archivedAt === null &&
  thread.settledOverride !== "settled" &&
  thread.pendingRuntimeRequest === null;

export function limitSwitchCommand(
  thread: ProjectionStore.ProjectionLimitRecoveryCandidate,
  targetInstanceId: ProviderInstanceId,
  nowMs: number,
  options: { readonly switchPinned?: boolean } = {},
): OrchestrationV2Command | null {
  if (!isSwitchable(thread, nowMs) || !thread.latestRunId) return null;
  if (thread.modelSelection.accountChoice === "pinned" && options.switchPinned !== true) {
    return null;
  }
  const identity = `${thread.id}:${thread.latestRunId}:${targetInstanceId}:${Math.floor(nowMs / RETRY_BUCKET_MS)}`;
  return {
    type: "message.dispatch",
    commandId: CommandId.make(`limit-switch:${identity}`),
    messageId: MessageId.make(`limit-switch:${identity}`),
    threadId: thread.id,
    manualContinuationOfRunId: thread.latestRunId,
    modelSelection: { ...thread.modelSelection, instanceId: targetInstanceId },
    text: "Continue where you left off.",
    attachments: [],
    dispatchMode: { type: "start_immediately" },
    createdBy: "user",
    creationSource: "server",
  };
}

export const makeSweep = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const registry = yield* ProviderRegistry.ProviderRegistry;
  const ledgerRef = yield* Ref.make(emptyLimitSwitchLedger);
  return Effect.fn("UsageLimitSwitchWorker.sweep")(function* () {
    const preferences = yield* settings.getSettings;
    if (preferences.limitedThreadSwitch !== "auto") return;
    const now = yield* DateTime.now;
    const nowMs = DateTime.toEpochMillis(now);
    const limited = (yield* projections.getLimitRecoveryCandidates({
      now,
      autoResume: true,
      snooze: true,
    })).filter((thread) => isSwitchable(thread, nowMs));
    if (limited.length === 0) return;

    const snapshot = yield* registry.getProviders;
    const peers = limited.flatMap((thread) =>
      rankUsageLimitSwitchCandidates({
        providers: snapshot,
        currentInstanceId: thread.providerInstanceId,
        nowMs,
        model: thread.modelSelection.model,
      }).map((candidate) => candidate.instanceId),
    );
    const due = instancesDueForRefresh(yield* Ref.get(ledgerRef), peers, nowMs);
    yield* Effect.forEach(
      due,
      (instanceId) =>
        registry.refreshInstance(instanceId).pipe(Effect.timeout(REFRESH_TIMEOUT), Effect.ignore),
      { concurrency: "unbounded", discard: true },
    );
    yield* Ref.update(ledgerRef, (ledger) => recordRefreshes(ledger, due, nowMs));
    const providers = due.length === 0 ? snapshot : yield* registry.getProviders;

    for (const thread of limited) {
      yield* Effect.gen(function* () {
        const ledger = yield* Ref.get(ledgerRef);
        if (!threadMaySwitch(ledger, thread.id, nowMs)) {
          yield* Effect.logDebug("orchestration-v2.limit-switch.thread-capped", {
            threadId: thread.id,
          });
          return;
        }
        const ranked = rankUsageLimitSwitchCandidates({
          providers,
          currentInstanceId: thread.providerInstanceId,
          nowMs,
          model: thread.modelSelection.model,
          recentAssignments: recentAssignmentCounts(ledger, nowMs),
        });
        const target = ranked.find((candidate) => candidate.usedPercent !== undefined);
        if (target === undefined) {
          yield* Effect.logDebug("orchestration-v2.limit-switch.no-target", {
            threadId: thread.id,
            from: thread.providerInstanceId,
            candidates: ranked.map((candidate) => candidate.instanceId),
          });
          return;
        }
        const command = limitSwitchCommand(thread, target.instanceId, nowMs, {
          switchPinned: preferences.switchPinnedAccounts,
        });
        if (command === null) return;
        yield* threads.dispatch(command);
        yield* Ref.update(ledgerRef, (current) =>
          recordLimitSwitch(current, { instanceId: target.instanceId, threadId: thread.id }, nowMs),
        );
        yield* Effect.logInfo("orchestration-v2.limit-switch.dispatched", {
          threadId: thread.id,
          from: thread.providerInstanceId,
          to: target.instanceId,
          model: thread.modelSelection.model,
          usedPercent: target.usedPercent,
          resetsAtMs: target.resetsAtMs,
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration-v2.limit-switch.dispatch-failed", {
            threadId: thread.id,
            cause,
          }),
        ),
      );
    }
  });
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sweep = yield* makeSweep;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("usage-limit-switch", sweep());
  }),
);
