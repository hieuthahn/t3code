import { describe, expect, it } from "vite-plus/test";

import {
  deriveAvailableInstanceId,
  findCodexHomeConflict,
  resolveCodexAccountConfig,
  getProviderIdentityDraft,
  resolveAcpRegistryWizardNavigation,
  resolveWizardNavigation,
  updateProviderIdentityDraft,
} from "./AddProviderInstanceDialog.logic";

describe("resolveWizardNavigation", () => {
  const invalidId = { instanceIdError: "Instance ID is required." };

  // regression: #2813 the wizard advanced past an invalid instance id
  it("blocks Next from Identity to Config while the instance id is invalid", () => {
    expect(resolveWizardNavigation(1, 2, 3, invalidId)).toEqual({
      kind: "blocked",
      step: 1,
      error: "Instance ID is required.",
    });
  });

  it("stops a direct Driver-to-Config skip at Identity and surfaces its error", () => {
    expect(resolveWizardNavigation(0, 2, 3, invalidId)).toEqual({
      kind: "blocked",
      step: 1,
      error: "Instance ID is required.",
    });
  });
});

describe("ACP Registry wizard", () => {
  it("requires a prepared result or valid manual configuration before Identity", () => {
    expect(
      resolveAcpRegistryWizardNavigation(0, 1, {
        instanceIdError: null,
        selectionError: "Select an ACP or configure one manually.",
      }),
    ).toEqual({
      kind: "blocked",
      step: 0,
      error: "Select an ACP or configure one manually.",
    });

    expect(
      resolveAcpRegistryWizardNavigation(0, 1, {
        instanceIdError: null,
        selectionError: null,
      }),
    ).toEqual({ kind: "navigate", step: 1 });
  });

  it("derives a collision-free instance id without exceeding the slug limit", () => {
    const derive = (label: string) => `acpRegistry_${label}`;
    const existing = new Set(["acpRegistry_gemini", "acpRegistry_gemini_2"]);

    expect(deriveAvailableInstanceId(derive, "gemini", existing)).toBe("acpRegistry_gemini_3");

    const longBase = `acpRegistry_${"a".repeat(48)}`;
    expect(deriveAvailableInstanceId(() => longBase, "ignored", new Set([longBase]))).toHaveLength(
      62,
    );
  });

  it("keeps registry-prefilled identity separate from other drivers", () => {
    const registryDrafts = updateProviderIdentityDraft({}, "acpRegistry", {
      label: "Gemini CLI",
      instanceIdOverride: "acpRegistry_gemini_cli",
    });

    expect(getProviderIdentityDraft(registryDrafts, "codex")).toEqual({
      label: "",
      accentColor: "",
      instanceIdOverride: null,
    });

    const drafts = updateProviderIdentityDraft(registryDrafts, "codex", {
      label: "Work",
      instanceIdOverride: "codex_work",
    });
    expect(getProviderIdentityDraft(drafts, "acpRegistry")).toMatchObject({
      label: "Gemini CLI",
      instanceIdOverride: "acpRegistry_gemini_cli",
    });
  });
});

describe("resolveCodexAccountConfig", () => {
  it("gives a shared-history account its own shadow home", () => {
    expect(
      resolveCodexAccountConfig({ config: {}, instanceId: "codex_work", shareHistory: true }),
    ).toEqual({
      shadowHomePath: "~/.codex-t3/codex_work",
    });
  });

  it("gives a separate account its own CODEX_HOME", () => {
    expect(
      resolveCodexAccountConfig({ config: {}, instanceId: "codex_work", shareHistory: false }),
    ).toEqual({
      homePath: "~/.codex-codex_work",
    });
  });

  it("keeps paths the user typed", () => {
    expect(
      resolveCodexAccountConfig({
        config: { shadowHomePath: "~/accounts/work" },
        instanceId: "codex_work",
        shareHistory: true,
      }),
    ).toEqual({ shadowHomePath: "~/accounts/work" });
  });
});

describe("findCodexHomeConflict", () => {
  const instances = {
    codex_personal: { driver: "codex", config: { shadowHomePath: "~/.codex-t3/personal" } },
    claudeAgent: { driver: "claudeAgent", config: { homePath: "~/.codex-t3/personal" } },
  };

  it("names the Codex instance that already signs in from the same home", () => {
    expect(
      findCodexHomeConflict({ config: { shadowHomePath: "~/.codex-t3/personal/" }, instances }),
    ).toBe("codex_personal");
  });

  it("treats the default Codex home as taken by the default instance", () => {
    expect(findCodexHomeConflict({ config: {}, instances })).toBe("codex");
    expect(findCodexHomeConflict({ config: { homePath: "~/.codex" }, instances })).toBe("codex");
  });

  it("allows a home no other Codex instance uses", () => {
    expect(
      findCodexHomeConflict({ config: { shadowHomePath: "~/.codex-t3/work" }, instances }),
    ).toBeNull();
  });
});
