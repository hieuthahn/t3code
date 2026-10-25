import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "../../index.css";
import { render } from "../../../test/render";
import type { ScopedSettingsPatch } from "./scopedSettings";

type Team = typeof DEFAULT_UNIFIED_SETTINGS.team;
const state = vi.hoisted(() => ({
  team: null as unknown as Team,
  updateSettings: vi.fn<(patch: ScopedSettingsPatch) => void>(),
}));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => vi.fn()) as never,
}));
vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => ({ ...DEFAULT_UNIFIED_SETTINGS, team: state.team })) as never,
  useScopedSettingsMixed: () => false,
  useUpdateScopedSettings: () => state.updateSettings,
}));
vi.mock(import("./SettingsScopeContext"), async (original) => ({
  ...(await original()),
  useSettingsScope: (() => ({
    scope: { kind: "all", environmentIds: [] },
    environment: null,
    connectedEnvironments: [],
    targets: [{ settings: { ...DEFAULT_UNIFIED_SETTINGS, team: state.team } }],
    target: null,
  })) as never,
}));

vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: (() => true) as never,
  useEnvironmentsWithScope: (() => []) as never,
}));

import { TeamAutoSettingRow } from "./TeamAutoSettingRow";

const defaultSetup = {
  architect: { instanceId: "claudeAgent", model: "claude-opus-5-5" },
  workers: [{ instanceId: "claudeAgent", model: "claude-sonnet-5-5" }],
  limits: DEFAULT_UNIFIED_SETTINGS.team.defaultSetup?.limits,
} as unknown as NonNullable<Team["defaultSetup"]>;

async function shoot(name: string) {
  if (import.meta.env.VITE_TEAM_AUTO_SHOTS === undefined) return;
  await page.viewport(900, 240);
  for (const theme of ["light", "dark"] as const) {
    document.documentElement.classList.toggle("dark", theme === "dark");
    await page.screenshot({ path: `${import.meta.env.VITE_TEAM_AUTO_SHOTS}/${name}-${theme}.png` });
  }
  document.documentElement.classList.remove("dark");
}

describe("TeamAutoSettingRow", () => {
  it("turns Team Auto on for new threads", async () => {
    state.team = { ...DEFAULT_UNIFIED_SETTINGS.team, defaultSetup, autoNewThreads: false };
    state.updateSettings.mockClear();
    await using _screen = await render(
      <div className="bg-background p-2 text-foreground">
        <TeamAutoSettingRow />
      </div>,
    );
    await shoot("team-auto");
    const toggle = page.getByRole("switch", { name: "Team Auto for new threads" });
    await expect.element(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    expect(state.updateSettings).toHaveBeenCalledWith({ team: { autoNewThreads: true } });
  });

  it("stays off until a default team exists", async () => {
    state.team = { ...DEFAULT_UNIFIED_SETTINGS.team, defaultSetup: null };
    await using _screen = await render(
      <div className="bg-background p-2 text-foreground">
        <TeamAutoSettingRow />
      </div>,
    );
    await shoot("team-auto-no-default");
    await expect
      .element(page.getByRole("switch", { name: "Team Auto for new threads" }))
      .toBeDisabled();
    expect(document.body.textContent).toContain("Start a team once");
  });
});
