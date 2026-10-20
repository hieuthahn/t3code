import {
  CommandId,
  MessageId,
  type OrchestrationV2Command,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import {
  limitedWindowIdForReset,
  rankUsageLimitSwitchCandidates,
} from "@t3tools/shared/usageLimitSwitchCandidates";

const REFRESH_TIMEOUT = "5 seconds";

export function limitSwitchCommand(
  thread: ProjectionStore.ProjectionLimitRecoveryCandidate,
  targetInstanceId: ProviderInstanceId,
): OrchestrationV2Command | null {
  if (
    thread.status !== "failed" ||
    thread.lastErrorClass !== "usage_limit" ||
    !thread.latestRunId ||
    !thread.usageLimitResetAt ||
    thread.archivedAt !== null ||
    thread.settledOverride === "settled" ||
    thread.pendingRuntimeRequest !== null
  )
    return null;
  const identity = `${thread.id}:${thread.latestRunId}:${targetInstanceId}`;
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

const makeSweep = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const registry = yield* ProviderRegistry.ProviderRegistry;
  return Effect.fn("UsageLimitSwitchWorker.sweep")(function* () {
    const preferences = yield* settings.getSettings;
    if (preferences.limitedThreadSwitch !== "auto") return;
    const now = yield* DateTime.now;
    const nowMs = DateTime.toEpochMillis(now);
    const candidates = yield* projections.getLimitRecoveryCandidates({
      now,
      autoResume: true,
      snooze: true,
    });
    for (const thread of candidates) {
      if (thread.usageLimitResetAt == null || Date.parse(thread.usageLimitResetAt) <= nowMs) continue;
      yield* Effect.gen(function* () {
        const snapshot = yield* registry.getProviders;
        const windowId = limitedWindowIdForReset(
          snapshot.find((provider) => provider.instanceId === thread.providerInstanceId),
          Date.parse(thread.usageLimitResetAt!),
        );
        const peers = rankUsageLimitSwitchCandidates({
          providers: snapshot,
          currentInstanceId: thread.providerInstanceId,
          windowId,
          nowMs,
          strategy: "soonest-reset",
        });
        yield* Effect.forEach(
          peers,
          (peer) =>
            registry
              .refreshInstance(peer.instanceId)
              .pipe(Effect.timeout(REFRESH_TIMEOUT), Effect.ignore),
          { concurrency: "unbounded", discard: true },
        );
        const providers = yield* registry.getProviders;
        const ranked = rankUsageLimitSwitchCandidates({
          providers,
          currentInstanceId: thread.providerInstanceId,
          windowId,
          nowMs,
          strategy: "soonest-reset",
        });
        yield* Effect.logInfo("orchestration-v2.limit-switch.ranked", {
          threadId: thread.id,
          from: thread.providerInstanceId,
          windowId,
          ranked: ranked.map((candidate) => ({
            instanceId: candidate.instanceId,
            usedPercent: candidate.usedPercent,
            resetsAtMs: candidate.resetsAtMs,
          })),
        });
        const target = ranked.find((candidate) => candidate.usedPercent !== undefined);
        if (target === undefined) return;
        const command = limitSwitchCommand(thread, target.instanceId);
        if (command === null) return;
        yield* threads.dispatch(command);
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
