export const SWITCH_CACHE_WARNING_MIN_TOKENS = 20_000;

/** Warn that switching accounts re-writes a large context into the new account's cache. */
export const limitSwitchCacheWarning = (usedTokens: number | null | undefined): string | null => {
  if (usedTokens == null || !Number.isFinite(usedTokens)) return null;
  if (usedTokens < SWITCH_CACHE_WARNING_MIN_TOKENS) return null;
  return `This thread has about ${Math.round(usedTokens / 1000)}k tokens of context. Switching re-writes it to the new account's cache.`;
};
