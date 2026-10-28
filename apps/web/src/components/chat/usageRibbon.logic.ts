import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { formatDuration, remainingPercent } from "@t3tools/shared/usageLimits";

export const USAGE_RIBBON_LOW_PERCENT = 20;

const MINUTE_MS = 60_000;
const SESSION_WINDOW_MINS = 300;
const WEEKLY_WINDOW_MINS = 10_080;

export interface UsageRibbonWindow {
  readonly id: string;
  readonly label: string;
  readonly fullLabel: string;
  readonly percentLeft: number;
  readonly timeLeft: string | null;
  readonly low: boolean;
}

export interface UsageRibbonCache {
  readonly state: "warm" | "cold";
  readonly timeLeft: string | null;
}

export interface UsageRibbon {
  readonly windows: ReadonlyArray<UsageRibbonWindow>;
  readonly cache: UsageRibbonCache | null;
}

const NO_WINDOWS: ReadonlyArray<UsageRibbonWindow> = [];

export function usageRibbonWindowLabel(window: ServerProviderUsageWindow): string {
  if (window.windowDurationMins === SESSION_WINDOW_MINS) return "5H";
  if (window.windowDurationMins === WEEKLY_WINDOW_MINS) return "7D";
  return window.label;
}

/** Format the time until a moment, or null once it has passed. */
export function formatTimeLeft(ms: number): string | null {
  if (!(ms > 0)) return null;
  return ms < MINUTE_MS ? "<1m" : formatDuration(ms);
}

function deriveWindow(window: ServerProviderUsageWindow, nowMs: number): UsageRibbonWindow {
  const resetsAtMs = window.resetsAt === undefined ? Number.NaN : Date.parse(window.resetsAt);
  const percentLeft = remainingPercent(window);
  return {
    id: window.id,
    label: usageRibbonWindowLabel(window),
    fullLabel: window.label,
    percentLeft,
    timeLeft: Number.isFinite(resetsAtMs) ? formatTimeLeft(resetsAtMs - nowMs) : null,
    low: percentLeft < USAGE_RIBBON_LOW_PERCENT,
  };
}

interface PromptCacheInput {
  readonly updatedAt: string | null | undefined;
  readonly promptCacheTtlMs: number | undefined;
  readonly promptCacheExpiresAt: string | undefined;
}

/** When the prompt cache expires, preferring the provider's request-based expiry. */
export function promptCacheExpiryMs(input: PromptCacheInput): number | null {
  if (input.promptCacheTtlMs === undefined || input.updatedAt == null) return null;
  const reportedMs =
    input.promptCacheExpiresAt === undefined ? Number.NaN : Date.parse(input.promptCacheExpiresAt);
  if (Number.isFinite(reportedMs)) return reportedMs;
  const updatedAtMs = Date.parse(input.updatedAt);
  return Number.isFinite(updatedAtMs) ? updatedAtMs + input.promptCacheTtlMs : null;
}

function deriveCache(
  input: PromptCacheInput & { readonly nowMs: number },
): UsageRibbonCache | null {
  const expiresAtMs = promptCacheExpiryMs(input);
  if (expiresAtMs === null || input.promptCacheTtlMs === undefined) return null;
  const remaining = expiresAtMs - input.nowMs;
  if (remaining <= 0) return { state: "cold", timeLeft: null };
  return {
    state: "warm",
    timeLeft: formatTimeLeft(Math.min(remaining, input.promptCacheTtlMs)),
  };
}

/** Derive the ribbon, or null when no window or cache state is known. */
export function deriveUsageRibbon(input: {
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly updatedAt: string | null | undefined;
  readonly promptCacheTtlMs: number | undefined;
  readonly promptCacheExpiresAt?: string | undefined;
  readonly nowMs: number;
}): UsageRibbon | null {
  const cache = deriveCache({
    updatedAt: input.updatedAt,
    promptCacheTtlMs: input.promptCacheTtlMs,
    promptCacheExpiresAt: input.promptCacheExpiresAt,
    nowMs: input.nowMs,
  });
  if (input.windows.length === 0 && cache === null) return null;
  return {
    windows:
      input.windows.length === 0
        ? NO_WINDOWS
        : input.windows.map((window) => deriveWindow(window, input.nowMs)),
    cache,
  };
}
