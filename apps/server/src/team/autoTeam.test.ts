import { DEFAULT_TEAM_LIMITS, ProviderInstanceId, type TeamSettings } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { autoTeamSetup, withAnswerAloneHint } from "./autoTeam.ts";

const setup = {
  architect: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" },
  workers: [{ instanceId: ProviderInstanceId.make("claudeAgent_dung"), model: "sonnet" }],
  limits: DEFAULT_TEAM_LIMITS,
};
const settings = (defaultSetup: TeamSettings["defaultSetup"]): TeamSettings => ({
  profiles: [{ id: "strong", name: "Strong team", setup }],
  defaultSetup,
  newThreads: false,
  autoNewThreads: true,
});
const thread = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" };

describe("autoTeamSetup", () => {
  it("returns nothing while no default team is saved", () => {
    expect(autoTeamSetup(undefined, thread)).toBeUndefined();
    expect(autoTeamSetup(settings(null), thread)).toBeUndefined();
  });

  it("makes the thread's model the architect and names the matching profile", () => {
    const auto = autoTeamSetup(settings(setup), {
      ...thread,
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    expect(auto?.name).toBe("Strong team");
    expect(auto?.setup.architect).toEqual({
      ...thread,
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    expect(auto?.setup.workers).toEqual(setup.workers);
  });

  it("leaves the name out when the default matches no profile", () => {
    expect(autoTeamSetup(settings({ ...setup, autonomous: true }), thread)?.name).toBeUndefined();
  });
});

describe("withAnswerAloneHint", () => {
  it("keeps the message and adds the hint after it", () => {
    const text = withAnswerAloneHint("what does retry default to?");
    expect(text.startsWith("what does retry default to?\n\n")).toBe(true);
    expect(text).toContain("without team_assign");
  });
});
