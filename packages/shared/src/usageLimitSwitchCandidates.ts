import type { ProviderInstanceId, ServerProvider } from "@t3tools/contracts";

export type UsageLimitSwitchStrategy = "soonest-reset" | "most-remaining";

export interface UsageLimitSwitchCandidate {
  readonly instanceId: ProviderInstanceId;
  readonly usedPercent: number | undefined;
  readonly resetsAtMs: number | undefined;
}

const FULL_PERCENT = 100;

const headroomOf = (candidate: UsageLimitSwitchCandidate): number =>
  FULL_PERCENT - (candidate.usedPercent ?? FULL_PERCENT);

const resetOrder = (candidate: UsageLimitSwitchCandidate): number =>
  candidate.resetsAtMs ?? Number.POSITIVE_INFINITY;

const toCandidate = (
  provider: ServerProvider,
  windowId: string,
  nowMs: number,
): UsageLimitSwitchCandidate | undefined => {
  const limits = provider.usageLimits;
  if (limits === undefined || limits.unavailable !== undefined) {
    return { instanceId: provider.instanceId, usedPercent: undefined, resetsAtMs: undefined };
  }
  const window = limits.windows.find((entry) => entry.id === windowId);
  if (window === undefined) {
    return { instanceId: provider.instanceId, usedPercent: undefined, resetsAtMs: undefined };
  }
  const resetsAtMs = window.resetsAt === undefined ? undefined : Date.parse(window.resetsAt);
  const windowRefilled = resetsAtMs !== undefined && resetsAtMs <= nowMs;
  const usedPercent = windowRefilled ? 0 : window.usedPercent;
  if (usedPercent >= FULL_PERCENT) {
    return undefined;
  }
  return { instanceId: provider.instanceId, usedPercent, resetsAtMs: windowRefilled ? undefined : resetsAtMs };
};

/**
 * Rank the instances a limited thread can continue on without a handoff:
 * same driver and continuation group, still under the limit in the window that was hit.
 * Instances with no usable reading come last, in their given order.
 */
export const rankUsageLimitSwitchCandidates = (input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly currentInstanceId: ProviderInstanceId;
  readonly windowId: string;
  readonly nowMs: number;
  readonly strategy: UsageLimitSwitchStrategy;
}): ReadonlyArray<UsageLimitSwitchCandidate> => {
  const current = input.providers.find((provider) => provider.instanceId === input.currentInstanceId);
  const groupKey = current?.continuation?.groupKey;
  if (current === undefined || groupKey === undefined) {
    return [];
  }
  const candidates = input.providers
    .filter(
      (provider) =>
        provider.instanceId !== input.currentInstanceId &&
        provider.enabled &&
        provider.driver === current.driver &&
        provider.continuation?.groupKey === groupKey,
    )
    .flatMap((provider) => {
      const candidate = toCandidate(provider, input.windowId, input.nowMs);
      return candidate === undefined ? [] : [candidate];
    });
  const measured = candidates.filter((candidate) => candidate.usedPercent !== undefined);
  const unmeasured = candidates.filter((candidate) => candidate.usedPercent === undefined);
  const byStrategy =
    input.strategy === "soonest-reset"
      ? (left: UsageLimitSwitchCandidate, right: UsageLimitSwitchCandidate) =>
          resetOrder(left) - resetOrder(right) || headroomOf(right) - headroomOf(left)
      : (left: UsageLimitSwitchCandidate, right: UsageLimitSwitchCandidate) =>
          headroomOf(right) - headroomOf(left) || resetOrder(left) - resetOrder(right);
  return [...measured.toSorted(byStrategy), ...unmeasured];
};

const RESET_MATCH_TOLERANCE_MS = 60_000;
const DEFAULT_LIMITED_WINDOW_ID = "five_hour";

/**
 * Name the window a failure's reset time belongs to by matching it against the limited
 * instance's last snapshot, defaulting to the session window.
 */
export const limitedWindowIdForReset = (
  provider: ServerProvider | undefined,
  resetAtMs: number,
): string => {
  const matched = provider?.usageLimits?.windows.find(
    (window) =>
      window.resetsAt !== undefined &&
      Math.abs(Date.parse(window.resetsAt) - resetAtMs) <= RESET_MATCH_TOLERANCE_MS,
  );
  return matched?.id ?? DEFAULT_LIMITED_WINDOW_ID;
};
