import { describe, expect, it } from "vite-plus/test";

import {
  SWITCH_CACHE_WARNING_MIN_TOKENS,
  limitSwitchCacheWarning,
} from "./limitSwitchCacheWarning";

describe("limitSwitchCacheWarning", () => {
  it("shows no line without a token figure", () => {
    expect(limitSwitchCacheWarning(null)).toBeNull();
    expect(limitSwitchCacheWarning(undefined)).toBeNull();
    expect(limitSwitchCacheWarning(Number.NaN)).toBeNull();
  });

  it("shows no line below the threshold", () => {
    expect(limitSwitchCacheWarning(SWITCH_CACHE_WARNING_MIN_TOKENS - 1)).toBeNull();
  });

  it("shows the line with a rounded count at or above the threshold", () => {
    expect(limitSwitchCacheWarning(SWITCH_CACHE_WARNING_MIN_TOKENS)).toContain("about 20k tokens");
    expect(limitSwitchCacheWarning(179_600)).toBe(
      "This thread has about 180k tokens of context. Switching re-writes it to the new account's cache.",
    );
  });
});
