import { describe, expect, it } from "vite-plus/test";

import { limitSwitchActionLabel } from "./limitSwitchActionLabel";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const label = (lostPercent: number | undefined, resetsInMinutes: number | undefined) =>
  limitSwitchActionLabel({
    accountLabel: "Work",
    lostPercent,
    resetsAtMs: resetsInMinutes === undefined ? undefined : NOW + resetsInMinutes * 60_000,
    nowMs: NOW,
  });

describe("limitSwitchActionLabel", () => {
  it("names the quota that expires and when", () => {
    expect(label(70, 120)).toBe("Switch to Work and continue (70% expires in 2h)");
    expect(label(40.4, 30)).toBe("Switch to Work and continue (40% expires in 30m)");
    expect(label(90, 3 * 24 * 60)).toBe("Switch to Work and continue (90% expires in 3d)");
  });

  it("keeps the plain label when nothing is lost or the figure is unknown", () => {
    expect(label(0, 120)).toBe("Switch to Work and continue");
    expect(label(undefined, 120)).toBe("Switch to Work and continue");
    expect(label(70, undefined)).toBe("Switch to Work and continue");
  });
});
