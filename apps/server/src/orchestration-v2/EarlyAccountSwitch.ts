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
  type AccountSwitchThresholds,
  chooseAccountForTurn,
} from "@t3tools/shared/usageLimitSwitchCandidates";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";

const THREAD_COOLDOWN_MS = 30 * 60_000;

type MessageDispatch = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;

export interface EarlySwitchThread {
  readonly id: ThreadId;
  readonly modelSelection: ModelSelection;
}

/** Tell whether a dispatch is a new user turn on the thread's own account. */
export const isEarlySwitchCandidate = (
  command: MessageDispatch,
  thread: EarlySwitchThread,
): boolean =>
  command.createdBy === "user" &&
  command.dispatchMode.type === "start_immediately" &&
  command.manualContinuationOfRunId === undefined &&
  command.restartContinuationOfRunId === undefined &&
  command.usageLimitContinuationOfRunId === undefined &&
  command.delegatedCompletion === undefined &&
  (command.modelSelection?.instanceId ?? thread.modelSelection.instanceId) ===
    thread.modelSelection.instanceId;

/**
 * Decide the account a user turn runs on, given the providers, the thread's last early
 * switch, and the thresholds; returns the choice and the rewritten command.
 */
export const planEarlySwitch = (input: {
  readonly command: MessageDispatch;
  readonly thread: EarlySwitchThread;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly thresholds: AccountSwitchThresholds;
  readonly lastSwitchAtMs: number | undefined;
  readonly nowMs: number;
}): { readonly command: MessageDispatch; readonly choice: AccountChoice | null } => {
  if (!isEarlySwitchCandidate(input.command, input.thread)) {
    return { command: input.command, choice: null };
  }
  if (
    input.lastSwitchAtMs !== undefined &&
    input.nowMs - input.lastSwitchAtMs < THREAD_COOLDOWN_MS
  ) {
    return { command: input.command, choice: null };
  }
  const selection = input.command.modelSelection ?? input.thread.modelSelection;
  const choice = chooseAccountForTurn({
    providers: input.providers,
    currentInstanceId: selection.instanceId,
    model: selection.model,
    nowMs: input.nowMs,
    thresholds: input.thresholds,
  });
  if (!choice.switched) return { command: input.command, choice };
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
  const lastSwitchRef = yield* Ref.make(new Map<ThreadId, number>());
  const unmeasuredLoggedRef = yield* Ref.make(new Set<string>());
  const rewrite = Effect.fn("EarlyAccountSwitch.rewrite")(function* (
    command: MessageDispatch,
    thread: EarlySwitchThread,
  ) {
    const preferences = yield* settings.getSettings;
    if (!preferences.earlyAccountSwitch || !isEarlySwitchCandidate(command, thread)) {
      return command;
    }
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const plan = planEarlySwitch({
      command,
      thread,
      providers: yield* registry.getProviders,
      thresholds: {
        sessionPercent: preferences.earlySwitchSessionThreshold,
        weeklyPercent: preferences.earlySwitchWeeklyThreshold,
      },
      lastSwitchAtMs: (yield* Ref.get(lastSwitchRef)).get(thread.id),
      nowMs,
    });
    const choice = plan.choice;
    if (choice === null || choice.reason === "under-threshold") return plan.command;
    const from: ProviderInstanceId = thread.modelSelection.instanceId;
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
