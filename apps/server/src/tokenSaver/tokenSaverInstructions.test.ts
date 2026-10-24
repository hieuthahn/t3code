import { DEFAULT_TOKEN_SAVER_CONFIG, type TokenSaverConfig } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES } from "../provider/CodexDeveloperInstructions.ts";

import {
  buildTokenSaverInstructions,
  effectiveTokenSaverConfig,
  tokenSaverProfileKey,
} from "./tokenSaverInstructions.ts";

const OFF: TokenSaverConfig = { concise: "off", leanCode: false, quietTools: false, rtk: false };
const TOOLS = { rtk: true };
const EXCEPTION = "Always write plain, complete sentences for security warnings";

describe("buildTokenSaverInstructions", () => {
  it("returns nothing when no pack is on", () => {
    expect(buildTokenSaverInstructions(undefined)).toBeUndefined();
    expect(buildTokenSaverInstructions(OFF)).toBeUndefined();
  });

  it.each(["lite", "full", "ultra"] as const)("keeps the fixed exception at %s", (concise) => {
    const text = buildTokenSaverInstructions({ ...OFF, concise });
    expect(text).toContain(EXCEPTION);
    expect(text).toContain("commit messages, pull requests or documentation");
    expect(text).toContain("### Concise replies");
  });

  it("keeps the exception for a tools-only profile", () => {
    const text = buildTokenSaverInstructions({ ...OFF, quietTools: true });
    expect(text).toContain(EXCEPTION);
    expect(text).toContain("### Quiet tools");
    expect(text).not.toContain("### Concise replies");
  });

  it("gets terser with each level", () => {
    const lite = buildTokenSaverInstructions({ ...OFF, concise: "lite" }) ?? "";
    const full = buildTokenSaverInstructions({ ...OFF, concise: "full" }) ?? "";
    const ultra = buildTokenSaverInstructions({ ...OFF, concise: "ultra" }) ?? "";
    expect(lite).toContain("Use short, normal sentences.");
    expect(full).toContain("sentence fragments");
    expect(ultra).toContain("fewest words");
    expect(new Set([lite, full, ultra]).size).toBe(3);
  });

  it.each(["lite", "full", "ultra"] as const)(
    "fits every pack at %s in one Codex context entry",
    (concise) => {
      const text = buildTokenSaverInstructions({
        concise,
        leanCode: true,
        quietTools: true,
        rtk: true,
      });
      expect(new TextEncoder().encode(text).length).toBeLessThan(
        CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES,
      );
    },
  );

  it("includes only the packs that are on", () => {
    const text = buildTokenSaverInstructions({ ...OFF, concise: "lite", leanCode: true }) ?? "";
    expect(text).toContain("### Lean code");
    expect(text).not.toContain("### Quiet tools");
    expect(text).not.toContain("### RTK compression");
  });

  it("tells the agent to prefix shell commands with rtk", () => {
    const text = buildTokenSaverInstructions({ ...OFF, rtk: true }) ?? "";
    expect(text).toContain("### RTK compression");
    expect(text).toContain("rtk git status");
    expect(text).toContain(EXCEPTION);
  });
});

describe("effectiveTokenSaverConfig", () => {
  const enabled = { newThreads: DEFAULT_TOKEN_SAVER_CONFIG };

  it("injects nothing for a thread without packs while new threads start off", () => {
    expect(effectiveTokenSaverConfig({ newThreads: OFF }, undefined, TOOLS)).toBeUndefined();
  });

  it("runs a thread's own packs even while new threads start off", () => {
    const override: TokenSaverConfig = { ...OFF, concise: "ultra" };
    expect(effectiveTokenSaverConfig({ newThreads: OFF }, override, TOOLS)).toEqual(override);
  });

  it("prefers the thread's override to the defaults", () => {
    const override: TokenSaverConfig = { ...OFF, concise: "full", leanCode: true };
    expect(effectiveTokenSaverConfig(enabled, override, TOOLS)).toEqual(override);
    expect(effectiveTokenSaverConfig(enabled, undefined, TOOLS)).toEqual(
      DEFAULT_TOKEN_SAVER_CONFIG,
    );
  });

  it("treats an all-off override as off", () => {
    expect(effectiveTokenSaverConfig(enabled, OFF, TOOLS)).toBeUndefined();
  });

  it("drops the rtk pack on a host without rtk", () => {
    const override: TokenSaverConfig = { ...OFF, quietTools: true, rtk: true };
    expect(effectiveTokenSaverConfig(enabled, override, { rtk: false })).toEqual({
      ...override,
      rtk: false,
    });
    expect(
      effectiveTokenSaverConfig(enabled, { ...OFF, rtk: true }, { rtk: false }),
    ).toBeUndefined();
  });
});

describe("tokenSaverProfileKey", () => {
  it("names the packs in a fixed order", () => {
    expect(tokenSaverProfileKey(DEFAULT_TOKEN_SAVER_CONFIG)).toBe("concise-lite+quiet-tools");
    expect(
      tokenSaverProfileKey({ concise: "ultra", leanCode: true, quietTools: true, rtk: true }),
    ).toBe("concise-ultra+lean-code+quiet-tools+rtk");
    expect(tokenSaverProfileKey(OFF)).toBe("off");
    expect(tokenSaverProfileKey(undefined)).toBe("off");
  });
});
