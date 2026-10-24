import { describe, expect, it } from "vite-plus/test";

import { TOKEN_SAVER_OFF_CONFIG, estimateTokenSaverSavingPercent } from "./tokenSaver.ts";

const WITH_RTK = { rtk: true };

describe("estimateTokenSaverSavingPercent", () => {
  it("is zero with every pack off", () => {
    expect(estimateTokenSaverSavingPercent(TOKEN_SAVER_OFF_CONFIG, WITH_RTK)).toBe(0);
  });

  it("compounds the packs instead of adding them", () => {
    const fullAndLean = { ...TOKEN_SAVER_OFF_CONFIG, concise: "full" as const, leanCode: true };
    expect(estimateTokenSaverSavingPercent(fullAndLean, WITH_RTK)).toBe(28);
    const everything = { concise: "ultra" as const, leanCode: true, quietTools: true, rtk: true };
    expect(estimateTokenSaverSavingPercent(everything, WITH_RTK)).toBe(57);
  });

  it("grows with the concise level", () => {
    const at = (concise: "lite" | "full" | "ultra") =>
      estimateTokenSaverSavingPercent({ ...TOKEN_SAVER_OFF_CONFIG, concise }, WITH_RTK);
    expect(at("lite")).toBeLessThan(at("full"));
    expect(at("full")).toBeLessThan(at("ultra"));
  });

  it("leaves rtk out where the host has no rtk", () => {
    const rtkOnly = { ...TOKEN_SAVER_OFF_CONFIG, rtk: true };
    expect(estimateTokenSaverSavingPercent(rtkOnly, WITH_RTK)).toBe(20);
    expect(estimateTokenSaverSavingPercent(rtkOnly, { rtk: false })).toBe(0);
  });
});
