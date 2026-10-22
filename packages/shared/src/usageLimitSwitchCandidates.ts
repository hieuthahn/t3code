import type {
  ProviderInstanceAccountSwitch,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";

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

export interface AccountSwitchThresholds {
  /** Percent of the session window at which an account counts as near its limit. */
  readonly sessionPercent: number;
  /** Percent of every longer window (weekly, monthly, per-model) that counts as near. */
  readonly weeklyPercent: number;
}

/** Build the per-account threshold lookup: each window from the account, else the defaults. */
export const resolveAccountSwitchThresholds =
  (input: {
    readonly defaults: AccountSwitchThresholds;
    readonly instances: Readonly<
      Record<string, { readonly accountSwitch?: ProviderInstanceAccountSwitch | undefined }>
    >;
  }) =>
  (instanceId: ProviderInstanceId): AccountSwitchThresholds => {
    const own = input.instances[instanceId]?.accountSwitch;
    return {
      sessionPercent: own?.sessionPercent ?? input.defaults.sessionPercent,
      weeklyPercent: own?.weeklyPercent ?? input.defaults.weeklyPercent,
    };
  };

/** A peer must sit this many points under each threshold before it takes a thread over. */
export const TARGET_HEADROOM_GAP_PERCENT = 20;

export type AccountChoiceReason =
  | "under-threshold"
  | "current-unmeasured"
  | "current-unknown"
  | "no-peer-with-headroom"
  | "near-limit";

export interface AccountChoice {
  readonly instanceId: ProviderInstanceId;
  readonly switched: boolean;
  readonly reason: AccountChoiceReason;
  /** The window that pushed the current account over, when one did. */
  readonly pressure?: {
    readonly windowId: string;
    readonly usedPercent: number;
    readonly thresholdPercent: number;
  };
  readonly target?: UsageLimitSwitchCandidate;
}

const thresholdFor = (kind: string, thresholds: AccountSwitchThresholds): number =>
  kind === "session" ? thresholds.sessionPercent : thresholds.weeklyPercent;

const liveWindows = (provider: ServerProvider, nowMs: number) => {
  const limits = provider.usageLimits;
  if (limits === undefined || limits.unavailable !== undefined || limits.windows.length === 0) {
    return undefined;
  }
  return limits.windows.filter((window) => {
    const resetsAtMs = window.resetsAt === undefined ? undefined : Date.parse(window.resetsAt);
    return resetsAtMs === undefined || resetsAtMs > nowMs;
  });
};

/**
 * Decide which account a thread's next turn runs on: stay put while every window is under
 * its threshold, otherwise move to the roomiest peer that is well under in every window.
 */
export const chooseAccountForTurn = (input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly currentInstanceId: ProviderInstanceId;
  readonly model: string;
  readonly nowMs: number;
  readonly thresholdsFor: (instanceId: ProviderInstanceId) => AccountSwitchThresholds;
  readonly recentAssignments?: ReadonlyMap<ProviderInstanceId, number>;
}): AccountChoice => {
  const stay = (reason: AccountChoiceReason): AccountChoice => ({
    instanceId: input.currentInstanceId,
    switched: false,
    reason,
  });
  const current = input.providers.find(
    (provider) => provider.instanceId === input.currentInstanceId,
  );
  if (current === undefined) return stay("current-unknown");
  const currentWindows = liveWindows(current, input.nowMs);
  if (currentWindows === undefined) return stay("current-unmeasured");
  const currentThresholds = input.thresholdsFor(input.currentInstanceId);
  const pressured = currentWindows
    .map((window) => ({
      windowId: window.id,
      usedPercent: window.usedPercent,
      thresholdPercent: thresholdFor(window.kind, currentThresholds),
    }))
    .filter((window) => window.usedPercent >= window.thresholdPercent)
    .sort((left, right) => right.usedPercent - left.usedPercent)[0];
  if (pressured === undefined) return stay("under-threshold");
  const roomy = (provider: ServerProvider): boolean => {
    const windows = liveWindows(provider, input.nowMs);
    const own = input.thresholdsFor(provider.instanceId);
    return (
      windows !== undefined &&
      windows.every(
        (window) =>
          window.usedPercent < thresholdFor(window.kind, own) - TARGET_HEADROOM_GAP_PERCENT,
      )
    );
  };
  const target = rankUsageLimitSwitchCandidates({
    providers: input.providers,
    currentInstanceId: input.currentInstanceId,
    nowMs: input.nowMs,
    model: input.model,
    ...(input.recentAssignments === undefined
      ? {}
      : { recentAssignments: input.recentAssignments }),
  }).find((candidate) => {
    const provider = input.providers.find((entry) => entry.instanceId === candidate.instanceId);
    return provider !== undefined && roomy(provider);
  });
  if (target === undefined) return { ...stay("no-peer-with-headroom"), pressure: pressured };
  return {
    instanceId: target.instanceId,
    switched: true,
    reason: "near-limit",
    pressure: pressured,
    target,
  };
};

/**
 * Pick the account a merged model row stands for: the thread's own account when it is in the
 * group, else the ready member with the most headroom, else the first member.
 */
export const pickRepresentativeAccount = (input: {
  readonly members: ReadonlyArray<ServerProvider>;
  readonly preferredInstanceId: ProviderInstanceId | undefined;
  readonly model: string;
  readonly nowMs: number;
}): ProviderInstanceId | undefined => {
  const preferred = input.members.find(
    (provider) => provider.instanceId === input.preferredInstanceId,
  );
  if (preferred !== undefined) return preferred.instanceId;
  const ready = input.members
    .filter((provider) => canTakeOver(provider, input.model))
    .flatMap((provider) => {
      const candidate = toCandidate(provider, input.nowMs);
      return candidate === undefined ? [] : [candidate];
    });
  const headroom = (candidate: UsageLimitSwitchCandidate) =>
    candidate.usedPercent === undefined ? -1 : FULL_PERCENT - candidate.usedPercent;
  const best = ready.sort((left, right) => headroom(right) - headroom(left))[0];
  return best?.instanceId ?? input.members[0]?.instanceId;
};
