import { TOKEN_SAVER_MIN_SAMPLE_TURNS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { summarizeTokenSaverUsage, type TokenSaverUsageGroup } from "./tokenSaverStats.ts";

const group = (overrides: Partial<TokenSaverUsageGroup>): TokenSaverUsageGroup => ({
  saverOn: false,
  inThread: false,
  turns: 0,
  outputTokens: 0,
  inputTokens: 0,
  cachedTurns: 0,
  cachedInputTokens: 0,
  ...overrides,
});

describe("summarizeTokenSaverUsage", () => {
  it("averages per turn for the thread and across every thread", () => {
    const stats = summarizeTokenSaverUsage([
      group({ saverOn: true, inThread: true, turns: 5, outputTokens: 1000, inputTokens: 50_000 }),
      group({ saverOn: true, inThread: false, turns: 5, outputTokens: 3000, inputTokens: 50_000 }),
      group({
        saverOn: false,
        inThread: false,
        turns: 10,
        outputTokens: 8000,
        inputTokens: 200_000,
        cachedTurns: 8,
        cachedInputTokens: 160_000,
      }),
    ]);
    expect(stats.thread.on).toEqual({
      turns: 5,
      averageOutputTokens: 200,
      averageInputTokens: 10_000,
      averageCachedInputTokens: null,
    });
    expect(stats.overall.on.averageOutputTokens).toBe(400);
    expect(stats.overall.on.turns).toBe(10);
    expect(stats.overall.off).toEqual({
      turns: 10,
      averageOutputTokens: 800,
      averageInputTokens: 20_000,
      averageCachedInputTokens: 20_000,
    });
  });

  it("shows no average below the minimum sample", () => {
    const stats = summarizeTokenSaverUsage([
      group({
        saverOn: true,
        inThread: true,
        turns: TOKEN_SAVER_MIN_SAMPLE_TURNS - 1,
        outputTokens: 400,
        inputTokens: 4000,
      }),
    ]);
    expect(stats.thread.on.turns).toBe(TOKEN_SAVER_MIN_SAMPLE_TURNS - 1);
    expect(stats.thread.on.averageOutputTokens).toBeNull();
    expect(stats.thread.on.averageInputTokens).toBeNull();
    expect(stats.thread.off).toEqual({
      turns: 0,
      averageOutputTokens: null,
      averageInputTokens: null,
      averageCachedInputTokens: null,
    });
  });
});
