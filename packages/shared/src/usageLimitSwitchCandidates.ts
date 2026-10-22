import type { ProviderInstanceId, ServerProvider } from "@t3tools/contracts";

export interface UsageLimitSwitchCandidate {
  readonly instanceId: ProviderInstanceId;
  /** Usage of the fullest window, so a peer near its weekly cap ranks below a fresh one. */
  readonly usedPercent: number | undefined;
  readonly resetsAtMs: number | undefined;
}

const FULL_PERCENT = 100;
const ASSIGNMENT_WEIGHT_PERCENT = 10;

const offersModel = (provider: ServerProvider, model: string | undefined): boolean =>
  model === undefined ||
  provider.models.some((entry) => entry.slug === model || entry.aliases?.includes(model) === true);

const canTakeOver = (provider: ServerProvider, model: string | undefined): boolean =>
  provider.enabled &&
  provider.installed &&
  provider.auth.status === "authenticated" &&
  provider.availability !== "unavailable" &&
  (provider.status === "ready" || provider.status === "warning") &&
  offersModel(provider, model);

const toCandidate = (
  provider: ServerProvider,
  nowMs: number,
): UsageLimitSwitchCandidate | undefined => {
  const limits = provider.usageLimits;
  if (limits === undefined || limits.unavailable !== undefined || limits.windows.length === 0) {
    return { instanceId: provider.instanceId, usedPercent: undefined, resetsAtMs: undefined };
  }
  let usedPercent = 0;
  let resetsAtMs: number | undefined;
  for (const window of limits.windows) {
    const windowResetMs = window.resetsAt === undefined ? undefined : Date.parse(window.resetsAt);
    if (windowResetMs !== undefined && windowResetMs <= nowMs) continue;
    if (window.usedPercent >= FULL_PERCENT) return undefined;
    if (window.usedPercent > usedPercent) {
      usedPercent = window.usedPercent;
      resetsAtMs = windowResetMs;
    }
  }
  return { instanceId: provider.instanceId, usedPercent, resetsAtMs };
};

/**
 * Rank the signed-in, ready instances a limited thread can continue on without a handoff.
 * Most headroom in the fullest window wins, and each recent assignment counts against a peer.
 */
export const rankUsageLimitSwitchCandidates = (input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly currentInstanceId: ProviderInstanceId;
  readonly nowMs: number;
  readonly model?: string | undefined;
  readonly recentAssignments?: ReadonlyMap<ProviderInstanceId, number>;
}): ReadonlyArray<UsageLimitSwitchCandidate> => {
  const current = input.providers.find(
    (provider) => provider.instanceId === input.currentInstanceId,
  );
  const groupKey = current?.continuation?.groupKey;
  if (current === undefined || groupKey === undefined) {
    return [];
  }
  const candidates = input.providers
    .filter(
      (provider) =>
        provider.instanceId !== input.currentInstanceId &&
        provider.driver === current.driver &&
        provider.continuation?.groupKey === groupKey &&
        canTakeOver(provider, input.model),
    )
    .flatMap((provider) => {
      const candidate = toCandidate(provider, input.nowMs);
      return candidate === undefined ? [] : [candidate];
    });
  const score = (candidate: UsageLimitSwitchCandidate): number =>
    FULL_PERCENT -
    (candidate.usedPercent ?? FULL_PERCENT) -
    (input.recentAssignments?.get(candidate.instanceId) ?? 0) * ASSIGNMENT_WEIGHT_PERCENT;
  const resetOrder = (candidate: UsageLimitSwitchCandidate): number =>
    candidate.resetsAtMs ?? Number.POSITIVE_INFINITY;
  const measured = candidates
    .filter((candidate) => candidate.usedPercent !== undefined)
    .sort((left, right) => score(right) - score(left) || resetOrder(left) - resetOrder(right));
  const unmeasured = candidates.filter((candidate) => candidate.usedPercent === undefined);
  return [...measured, ...unmeasured];
};
