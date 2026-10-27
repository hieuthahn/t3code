import type {
  ModelSelection,
  OrchestrationV2Command,
  ProviderInstanceId,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import {
  type AccountChoice,
  type AccountChoiceReason,
  type AccountSwitchThresholds,
  chooseAccountForTurn,
  isSpentAccount,
  pickNewThreadAccount,
  rankUsageLimitSwitchCandidates,
  resolveAccountSwitchThresholds,
} from "@t3tools/shared/usageLimitSwitchCandidates";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AccountSwitchJournal from "./AccountSwitchJournal.ts";

const THREAD_COOLDOWN_MS = 30 * 60_000;
const NEW_THREAD_ASSIGNMENT_WINDOW_MS = 60 * 60_000;
const USAGE_STALE_MS = 60_000;
const USAGE_REFRESH_TIMEOUT = "5 seconds";
const MAX_PEER_REFRESHES = 3;

const JOURNAL_REASONS: Partial<
  Record<AccountChoiceReason, AccountSwitchJournal.AccountSwitchReason>
> = {
  "near-limit": "near-limit",
  "current-signed-out": "signed-out",
  "requested-spent": "usage-limit",
};

/** Tell whether an account's usage reading is old enough to read again before deciding. */
const isUsageStale = (
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
  nowMs: number,
): boolean => {
  const limits = providers.find((provider) => provider.instanceId === instanceId)?.usageLimits;
  if (limits?.unavailable?.reason === "unsupported") return false;
  return limits === undefined || nowMs - Date.parse(limits.checkedAt) > USAGE_STALE_MS;
};

type MessageDispatch = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;

export interface EarlySwitchThread {
  readonly id: ThreadId;
  readonly modelSelection: ModelSelection;
  /** False only before the thread's first run started; new threads spread across the group. */
  readonly hasStartedRun?: boolean;
}

/**
 * Tell whether a dispatch is a new user turn. A launched thread's first message defers its
 * start until the workspace is ready, so it counts too.
 */
export const isEarlySwitchCandidate = (
  command: MessageDispatch,
  thread: EarlySwitchThread,
): boolean =>
  command.createdBy === "user" &&
  (command.dispatchMode.type === "start_immediately" ||
    (command.dispatchMode.type === "defer_start" && thread.hasStartedRun === false)) &&
  command.manualContinuationOfRunId === undefined &&
  command.restartContinuationOfRunId === undefined &&
  command.usageLimitContinuationOfRunId === undefined &&
  command.delegatedCompletion === undefined;

/**
 * Point a user's unpinned pick of another account in the thread's history group back at the
 * thread's account, because in auto mode the server moves threads and a draft can lag behind.
 */
export const followThreadAccount = (
  command: MessageDispatch,
  thread: EarlySwitchThread,
  providers: ReadonlyArray<ServerProvider>,
): MessageDispatch => {
  const selection = command.modelSelection;
  const threadInstanceId = thread.modelSelection.instanceId;
  if (
    selection === undefined ||
    selection.accountChoice === "pinned" ||
    selection.instanceId === threadInstanceId ||
    thread.hasStartedRun === false ||
    command.createdBy !== "user" ||
    command.manualContinuationOfRunId !== undefined ||
    command.restartContinuationOfRunId !== undefined ||
    command.usageLimitContinuationOfRunId !== undefined ||
    command.delegatedCompletion !== undefined
  ) {
    return command;
  }
  const groupOf = (instanceId: ProviderInstanceId) =>
    providers.find((provider) => provider.instanceId === instanceId)?.continuation?.groupKey;
  const group = groupOf(selection.instanceId);
  const threadOffersModel =
    providers
      .find((provider) => provider.instanceId === threadInstanceId)
      ?.models.some(
        (model) => model.slug === selection.model || model.aliases?.includes(selection.model),
      ) === true;
  return group !== undefined && group === groupOf(threadInstanceId) && threadOffersModel
    ? { ...command, modelSelection: { ...selection, instanceId: threadInstanceId } }
    : command;
};

/**
 * Decide the account a user turn runs on, given the providers, the thread's last early
 * switch, and the thresholds; returns the choice and the rewritten command.
 */
export const planEarlySwitch = (input: {
  readonly command: MessageDispatch;
  readonly switchPinned: boolean;
  /** False keeps pressured accounts; a signed-out account still moves. Defaults to true. */
  readonly switchNearLimit?: boolean;
  /** Present for a thread's first turn, when new threads spread across the group. */
  readonly newThread?: { readonly recentAssignments: ReadonlyMap<ProviderInstanceId, number> };
  readonly thread: EarlySwitchThread;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly thresholdsFor: (instanceId: ProviderInstanceId) => AccountSwitchThresholds;
  readonly lastSwitchAtMs: number | undefined;
  readonly nowMs: number;
}): { readonly command: MessageDispatch; readonly choice: AccountChoice | null } => {
  const selection = input.command.modelSelection ?? input.thread.modelSelection;
  // An unpinned pick of another account is a stale client draft, not a choice to honor.
  const leavesSpentAccount =
    selection.instanceId !== input.thread.modelSelection.instanceId &&
    isSpentAccount(input.providers, selection.instanceId, input.nowMs);
  if (
    !isEarlySwitchCandidate(input.command, input.thread) ||
    (!input.switchPinned && selection.accountChoice === "pinned")
  ) {
    return { command: input.command, choice: null };
  }
  if (
    !leavesSpentAccount &&
    input.lastSwitchAtMs !== undefined &&
    input.nowMs - input.lastSwitchAtMs < THREAD_COOLDOWN_MS
  ) {
    return { command: input.command, choice: null };
  }
  if (input.newThread !== undefined && !leavesSpentAccount) {
    const instanceId = pickNewThreadAccount({
      providers: input.providers,
      proposedInstanceId: selection.instanceId,
      model: selection.model,
      nowMs: input.nowMs,
      thresholdsFor: input.thresholdsFor,
      recentAssignments: input.newThread.recentAssignments,
    });
    const choice: AccountChoice = {
      instanceId,
      switched: instanceId !== selection.instanceId,
      reason: "new-thread",
    };
    return choice.switched
      ? { command: { ...input.command, modelSelection: { ...selection, instanceId } }, choice }
      : { command: input.command, choice };
  }
  const ranked = chooseAccountForTurn({
    providers: input.providers,
    currentInstanceId: selection.instanceId,
    model: selection.model,
    nowMs: input.nowMs,
    thresholdsFor: input.thresholdsFor,
  });
  const threadInstanceId = input.thread.modelSelection.instanceId;
  const choice: AccountChoice =
    leavesSpentAccount &&
    !ranked.switched &&
    !isSpentAccount(input.providers, threadInstanceId, input.nowMs)
      ? { instanceId: threadInstanceId, switched: true, reason: "requested-spent" }
      : ranked;
  if (!choice.switched) return { command: input.command, choice };
  if (
    input.switchNearLimit === false &&
    choice.reason !== "current-signed-out" &&
    !leavesSpentAccount
  ) {
    return { command: input.command, choice: null };
  }
  return {
    command: { ...input.command, modelSelection: { ...selection, instanceId: choice.instanceId } },
    choice,
  };
};

export class EarlyAccountSwitch extends Context.Service<
  EarlyAccountSwitch,
  {
    readonly rewrite: (
      command: MessageDispatch,
      thread: EarlySwitchThread,
    ) => Effect.Effect<MessageDispatch>;
  }
>()("t3/orchestration-v2/EarlyAccountSwitch") {}

export const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const registryOption = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
  if (Option.isNone(registryOption)) {
    yield* Effect.logWarning("orchestration-v2.early-switch.unavailable", {
      reason: "no provider registry in this runtime",
    });
    return EarlyAccountSwitch.of({ rewrite: (command) => Effect.succeed(command) });
  }
  const registry = registryOption.value;
  const journal = yield* AccountSwitchJournal.AccountSwitchJournal;
  const lastSwitchRef = yield* Ref.make(new Map<ThreadId, number>());
  const unmeasuredLoggedRef = yield* Ref.make(new Set<string>());
  const refreshAttemptsRef = yield* Ref.make(new Map<ProviderInstanceId, number>());
  const newThreadAssignmentsRef = yield* Ref.make<
    ReadonlyArray<{ readonly instanceId: ProviderInstanceId; readonly atMs: number }>
  >([]);
  const refreshStale = Effect.fn("EarlyAccountSwitch.refreshStale")(function* (
    providers: ReadonlyArray<ServerProvider>,
    instanceIds: ReadonlyArray<ProviderInstanceId>,
    nowMs: number,
  ) {
    const attempts = yield* Ref.get(refreshAttemptsRef);
    const due = [...new Set(instanceIds)].filter(
      (instanceId) =>
        isUsageStale(providers, instanceId, nowMs) &&
        nowMs - (attempts.get(instanceId) ?? 0) > USAGE_STALE_MS,
    );
    if (due.length === 0) return false;
    yield* Ref.update(refreshAttemptsRef, (current) => {
      const next = new Map(current);
      for (const instanceId of due) next.set(instanceId, nowMs);
      return next;
    });
    yield* Effect.forEach(
      due,
      (instanceId) =>
        registry.refreshInstance(instanceId).pipe(
          Effect.timeout(USAGE_REFRESH_TIMEOUT),
          Effect.catchCause(() => Effect.void),
        ),
      { concurrency: "unbounded", discard: true },
    );
    return true;
  });
  const rewrite = Effect.fn("EarlyAccountSwitch.rewrite")(function* (
    requested: MessageDispatch,
    thread: EarlySwitchThread,
  ) {
    const preferences = yield* settings.getSettings;
    const balanceNewThread = preferences.modelPickerMergeAccounts && thread.hasStartedRun === false;
    const command = preferences.modelPickerMergeAccounts
      ? followThreadAccount(requested, thread, yield* registry.getProviders)
      : requested;
    if (command !== requested) {
      yield* Effect.logInfo("orchestration-v2.early-switch.followed-thread", {
        threadId: thread.id,
        requested: requested.modelSelection?.instanceId,
        to: thread.modelSelection.instanceId,
      });
    }
    if (
      !(preferences.earlyAccountSwitch || balanceNewThread) ||
      !isEarlySwitchCandidate(command, thread)
    ) {
      return command;
    }
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const recentNewThreads = (yield* Ref.get(newThreadAssignmentsRef)).filter(
      (assignment) => nowMs - assignment.atMs < NEW_THREAD_ASSIGNMENT_WINDOW_MS,
    );
    const recentAssignments = new Map<ProviderInstanceId, number>();
    for (const assignment of recentNewThreads) {
      recentAssignments.set(
        assignment.instanceId,
        (recentAssignments.get(assignment.instanceId) ?? 0) + 1,
      );
    }
    const thresholdsFor = resolveAccountSwitchThresholds({
      defaults: {
        sessionPercent: preferences.earlySwitchSessionThreshold,
        weeklyPercent: preferences.earlySwitchWeeklyThreshold,
      },
      instances: preferences.providerInstances,
    });
    const lastSwitchAtMs = (yield* Ref.get(lastSwitchRef)).get(thread.id);
    const planWith = (providers: ReadonlyArray<ServerProvider>) =>
      planEarlySwitch({
        command,
        switchPinned: preferences.switchPinnedAccounts,
        switchNearLimit: preferences.earlyAccountSwitch,
        ...(balanceNewThread ? { newThread: { recentAssignments } } : {}),
        thread,
        providers,
        thresholdsFor,
        lastSwitchAtMs,
        nowMs,
      });
    let providers = yield* registry.getProviders;
    let plan = planWith(providers);
    if (plan.choice !== null && plan.choice.reason !== "new-thread") {
      const selection = command.modelSelection ?? thread.modelSelection;
      const readAgain = Effect.gen(function* () {
        providers = yield* registry.getProviders;
        plan = planWith(providers);
      });
      yield* Effect.gen(function* () {
        if (yield* refreshStale(providers, [selection.instanceId], nowMs)) yield* readAgain;
        if (plan.choice?.pressure === undefined) return;
        const peers = rankUsageLimitSwitchCandidates({
          providers,
          currentInstanceId: selection.instanceId,
          nowMs,
          model: selection.model,
        })
          .slice(0, MAX_PEER_REFRESHES)
          .map((candidate) => candidate.instanceId);
        if (yield* refreshStale(providers, peers, nowMs)) yield* readAgain;
      }).pipe(Effect.timeout(USAGE_REFRESH_TIMEOUT), Effect.ignore);
    }
    const choice = plan.choice;
    if (choice?.reason === "new-thread") {
      yield* Ref.set(newThreadAssignmentsRef, [
        ...recentNewThreads,
        { instanceId: choice.instanceId, atMs: nowMs },
      ]);
      yield* Effect.logInfo("orchestration-v2.early-switch.new-thread", {
        threadId: thread.id,
        proposed: thread.modelSelection.instanceId,
        to: choice.instanceId,
      });
      return plan.command;
    }
    if (choice === null || choice.reason === "under-threshold") return plan.command;
    const from: ProviderInstanceId =
      command.modelSelection?.instanceId ?? thread.modelSelection.instanceId;
    if (!choice.switched) {
      if (choice.pressure === undefined) {
        const key = `${thread.id}\0${from}`;
        const logged = yield* Ref.modify(unmeasuredLoggedRef, (keys) => [
          keys.has(key),
          new Set(keys).add(key),
        ]);
        if (logged) return plan.command;
      }
      yield* Effect.logInfo("orchestration-v2.early-switch.stayed", {
        threadId: thread.id,
        from,
        reason: choice.reason,
        ...(choice.pressure === undefined ? {} : choice.pressure),
      });
      return plan.command;
    }
    yield* Ref.update(lastSwitchRef, (current) => new Map(current).set(thread.id, nowMs));
    const journalReason = JOURNAL_REASONS[choice.reason];
    if (journalReason !== undefined) {
      const pressure = AccountSwitchJournal.notePressure(providers, from, choice.pressure);
      yield* journal.record(thread.id, {
        from,
        to: choice.instanceId,
        reason: journalReason,
        ...(pressure === undefined ? {} : { pressure }),
      });
    }
    yield* Effect.logInfo("orchestration-v2.early-switch.switched", {
      threadId: thread.id,
      from,
      to: choice.instanceId,
      reason: choice.reason,
      ...choice.pressure,
      targetUsedPercent: choice.target?.usedPercent,
    });
    return plan.command;
  });
  return EarlyAccountSwitch.of({
    rewrite: (command, thread) =>
      rewrite(command, thread).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration-v2.early-switch.failed", {
            threadId: thread.id,
            cause,
          }).pipe(Effect.as(command)),
        ),
      ),
  });
});

export const layer = Layer.effect(EarlyAccountSwitch, make);
