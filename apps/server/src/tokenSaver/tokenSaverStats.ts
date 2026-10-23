import {
  TOKEN_SAVER_MIN_SAMPLE_TURNS,
  type TokenSaverComparison,
  type TokenSaverStats,
  type TokenSaverTurnSample,
} from "@t3tools/contracts";

/** Sums over the measured turns of one thread-or-elsewhere, saver-on-or-off group. */
export interface TokenSaverUsageGroup {
  readonly saverOn: boolean;
  readonly inThread: boolean;
  readonly turns: number;
  readonly outputTokens: number;
  readonly inputTokens: number;
  readonly cachedTurns: number;
  readonly cachedInputTokens: number;
}

const average = (sum: number, count: number) =>
  count < TOKEN_SAVER_MIN_SAMPLE_TURNS ? null : sum / count;

function sample(groups: ReadonlyArray<TokenSaverUsageGroup>): TokenSaverTurnSample {
  const total = groups.reduce(
    (sum, group) => ({
      turns: sum.turns + group.turns,
      outputTokens: sum.outputTokens + group.outputTokens,
      inputTokens: sum.inputTokens + group.inputTokens,
      cachedTurns: sum.cachedTurns + group.cachedTurns,
      cachedInputTokens: sum.cachedInputTokens + group.cachedInputTokens,
    }),
    { turns: 0, outputTokens: 0, inputTokens: 0, cachedTurns: 0, cachedInputTokens: 0 },
  );
  return {
    turns: total.turns,
    averageOutputTokens: average(total.outputTokens, total.turns),
    averageInputTokens: average(total.inputTokens, total.turns),
    averageCachedInputTokens: average(total.cachedInputTokens, total.cachedTurns),
  };
}

function compare(groups: ReadonlyArray<TokenSaverUsageGroup>): TokenSaverComparison {
  return {
    on: sample(groups.filter((group) => group.saverOn)),
    off: sample(groups.filter((group) => !group.saverOn)),
  };
}

/** Averages each side only once it has the minimum sample, so a handful of turns shows no number. */
export function summarizeTokenSaverUsage(
  groups: ReadonlyArray<TokenSaverUsageGroup>,
): TokenSaverStats {
  return {
    thread: compare(groups.filter((group) => group.inThread)),
    overall: compare(groups),
  };
}
