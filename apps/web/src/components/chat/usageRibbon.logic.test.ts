import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveUsageRibbon,
  formatTimeLeft,
  promptCacheExpiryMs,
  usageRibbonWindowLabel,
  USAGE_RIBBON_LOW_PERCENT,
} from "./usageRibbon.logic";

const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const usageWindow = (
  overrides: Partial<ServerProviderUsageWindow> & { id: string },
): ServerProviderUsageWindow => ({
  kind: "other",
  label: "Window",
  usedPercent: 0,
  ...overrides,
});

const iso = (ms: number) => new Date(ms).toISOString();

describe("usageRibbonWindowLabel", () => {
  it("shortens the 5 hour and 7 day windows", () => {
    expect(usageRibbonWindowLabel(usageWindow({ id: "a", windowDurationMins: 300 }))).toBe("5H");
    expect(usageRibbonWindowLabel(usageWindow({ id: "a", windowDurationMins: 10080 }))).toBe("7D");
  });

  it("keeps the provider label for other durations or none", () => {
    expect(
      usageRibbonWindowLabel(usageWindow({ id: "a", label: "Monthly", windowDurationMins: 43200 })),
    ).toBe("Monthly");
    expect(usageRibbonWindowLabel(usageWindow({ id: "a", label: "Overall" }))).toBe("Overall");
  });
});

describe("formatTimeLeft", () => {
  it("formats minutes, hours, and days", () => {
    expect(formatTimeLeft(42 * MINUTE)).toBe("42m");
    expect(formatTimeLeft(2 * HOUR + 10 * MINUTE)).toBe("2h 10m");
    expect(formatTimeLeft(3 * DAY + 4 * HOUR)).toBe("3d 4h");
  });

  it("rounds under one minute to a floor label", () => {
    expect(formatTimeLeft(30_000)).toBe("<1m");
  });

  it("returns null once the moment has passed", () => {
    expect(formatTimeLeft(0)).toBeNull();
    expect(formatTimeLeft(-5 * MINUTE)).toBeNull();
  });
});

describe("deriveUsageRibbon windows", () => {
  const derive = (windows: ReadonlyArray<ServerProviderUsageWindow>) =>
    deriveUsageRibbon({
      windows,
      updatedAt: null,
      promptCacheTtlMs: undefined,
      nowMs: NOW,
    });

  it("shows percent left and time until reset per window", () => {
    const ribbon = derive([
      usageWindow({
        id: "weekly",
        label: "Weekly",
        usedPercent: 32,
        resetsAt: iso(NOW + 3 * DAY + 4 * HOUR),
        windowDurationMins: 10080,
      }),
      usageWindow({
        id: "session",
        label: "Session",
        usedPercent: 18,
        resetsAt: iso(NOW + 2 * HOUR + 10 * MINUTE),
        windowDurationMins: 300,
      }),
    ]);
    expect(ribbon?.windows).toEqual([
      {
        id: "weekly",
        label: "7D",
        fullLabel: "Weekly",
        percentLeft: 68,
        timeLeft: "3d 4h",
        low: false,
      },
      {
        id: "session",
        label: "5H",
        fullLabel: "Session",
        percentLeft: 82,
        timeLeft: "2h 10m",
        low: false,
      },
    ]);
  });

  it("drops the time segment when the reset is in the past or unknown", () => {
    const ribbon = derive([
      usageWindow({ id: "past", usedPercent: 10, resetsAt: iso(NOW - HOUR) }),
      usageWindow({ id: "none", usedPercent: 10 }),
    ]);
    expect(ribbon?.windows.map((entry) => entry.timeLeft)).toEqual([null, null]);
    expect(ribbon?.windows.map((entry) => entry.percentLeft)).toEqual([90, 90]);
  });

  it("handles 0% and 100% used", () => {
    const ribbon = derive([
      usageWindow({ id: "fresh", usedPercent: 0 }),
      usageWindow({ id: "spent", usedPercent: 100 }),
    ]);
    expect(ribbon?.windows.map((entry) => entry.percentLeft)).toEqual([100, 0]);
    expect(ribbon?.windows.map((entry) => entry.low)).toEqual([false, true]);
  });

  it("marks a window low strictly under the threshold", () => {
    const left = (percentLeft: number) =>
      derive([usageWindow({ id: "w", usedPercent: 100 - percentLeft })])?.windows[0]?.low;
    expect(USAGE_RIBBON_LOW_PERCENT).toBe(20);
    expect(left(19)).toBe(true);
    expect(left(20)).toBe(false);
  });

  it("returns nothing when no windows and no cache are known", () => {
    expect(derive([])).toBeNull();
  });

  it("returns the same empty windows reference when only the cache is known", () => {
    const first = deriveUsageRibbon({
      windows: [],
      updatedAt: iso(NOW),
      promptCacheTtlMs: 5 * MINUTE,
      nowMs: NOW,
    });
    const second = deriveUsageRibbon({
      windows: [],
      updatedAt: iso(NOW),
      promptCacheTtlMs: 5 * MINUTE,
      nowMs: NOW + 1,
    });
    expect(first?.windows).toBe(second?.windows);
  });
});

describe("deriveUsageRibbon cache", () => {
  const derive = (input: {
    updatedAt: string | null | undefined;
    promptCacheTtlMs: number | undefined;
    promptCacheExpiresAt?: string;
    nowMs?: number;
  }) =>
    deriveUsageRibbon({
      windows: [],
      updatedAt: input.updatedAt,
      promptCacheTtlMs: input.promptCacheTtlMs,
      promptCacheExpiresAt: input.promptCacheExpiresAt,
      nowMs: input.nowMs ?? NOW,
    })?.cache ?? null;

  it("counts the cache lifetime from the reported expiry, not from the response time", () => {
    const ttl = 5 * MINUTE;
    expect(
      derive({
        updatedAt: iso(NOW - MINUTE),
        promptCacheTtlMs: ttl,
        promptCacheExpiresAt: iso(NOW - 30_000),
      }),
    ).toEqual({ state: "cold", timeLeft: null });
    expect(
      derive({
        updatedAt: iso(NOW - MINUTE),
        promptCacheTtlMs: ttl,
        promptCacheExpiresAt: iso(NOW + 2 * MINUTE),
      }),
    ).toEqual({ state: "warm", timeLeft: "2m" });
  });

  it("falls back to activity plus TTL when the reported expiry is unreadable", () => {
    expect(
      derive({
        updatedAt: iso(NOW - 18 * MINUTE),
        promptCacheTtlMs: HOUR,
        promptCacheExpiresAt: "not a date",
      }),
    ).toEqual({ state: "warm", timeLeft: "42m" });
  });

  it("exposes the expiry moment so the view can re-render exactly when it passes", () => {
    expect(
      promptCacheExpiryMs({
        updatedAt: iso(NOW),
        promptCacheTtlMs: HOUR,
        promptCacheExpiresAt: iso(NOW + MINUTE),
      }),
    ).toBe(NOW + MINUTE);
    expect(
      promptCacheExpiryMs({
        updatedAt: iso(NOW),
        promptCacheTtlMs: HOUR,
        promptCacheExpiresAt: undefined,
      }),
    ).toBe(NOW + HOUR);
    expect(
      promptCacheExpiryMs({
        updatedAt: iso(NOW),
        promptCacheTtlMs: undefined,
        promptCacheExpiresAt: undefined,
      }),
    ).toBeNull();
  });

  it("is warm with the minutes left inside the TTL", () => {
    expect(derive({ updatedAt: iso(NOW - 18 * MINUTE), promptCacheTtlMs: HOUR })).toEqual({
      state: "warm",
      timeLeft: "42m",
    });
  });

  it("turns cold exactly at the TTL", () => {
    const ttl = 5 * MINUTE;
    expect(derive({ updatedAt: iso(NOW - ttl + 1), promptCacheTtlMs: ttl })?.state).toBe("warm");
    expect(derive({ updatedAt: iso(NOW - ttl), promptCacheTtlMs: ttl })).toEqual({
      state: "cold",
      timeLeft: null,
    });
    expect(derive({ updatedAt: iso(NOW - ttl - 1), promptCacheTtlMs: ttl })?.state).toBe("cold");
  });

  it("hides the badge without a TTL, without activity, or with a bad timestamp", () => {
    expect(derive({ updatedAt: iso(NOW), promptCacheTtlMs: undefined })).toBeNull();
    expect(derive({ updatedAt: null, promptCacheTtlMs: HOUR })).toBeNull();
    expect(derive({ updatedAt: undefined, promptCacheTtlMs: HOUR })).toBeNull();
    expect(derive({ updatedAt: "not a date", promptCacheTtlMs: HOUR })).toBeNull();
  });

  it("never reports more than the TTL left when activity is ahead of the clock", () => {
    expect(derive({ updatedAt: iso(NOW + 10 * MINUTE), promptCacheTtlMs: HOUR })).toEqual({
      state: "warm",
      timeLeft: "1h 0m",
    });
  });

  it("keeps the windows beside the cache badge", () => {
    const ribbon = deriveUsageRibbon({
      windows: [usageWindow({ id: "w", usedPercent: 50 })],
      updatedAt: iso(NOW),
      promptCacheTtlMs: HOUR,
      nowMs: NOW,
    });
    expect(ribbon?.windows).toHaveLength(1);
    expect(ribbon?.cache?.state).toBe("warm");
  });
});
