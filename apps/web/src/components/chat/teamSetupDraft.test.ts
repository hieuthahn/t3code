import { DEFAULT_TEAM_LIMITS, ProviderInstanceId, type TeamSetup } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canAddTeamWorker,
  decidedTeam,
  draftTeam,
  initialTeamSetup,
  leadGuidanceBytesLeft,
  teamControlName,
  teamModelSuffix,
  teamSetupLabel,
  teamWithArchitect,
  upsertTeamProfile,
} from "./teamSetupDraft";

const architect = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-opus-4-1" };
const worker = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" };
const saved: TeamSetup = { architect: worker, workers: [worker], limits: DEFAULT_TEAM_LIMITS };

describe("initialTeamSetup", () => {
  it("opens on the thread's own team when it runs as one", () => {
    expect(
      initialTeamSetup({ threadTeam: saved, defaultSetup: null, threadModel: architect }),
    ).toBe(saved);
  });

  it("starts from the saved default with the thread's model as architect", () => {
    expect(
      initialTeamSetup({ threadTeam: null, defaultSetup: saved, threadModel: architect }),
    ).toEqual({ ...saved, architect });
  });

  it("starts from the thread's model alone when nothing is saved", () => {
    expect(
      initialTeamSetup({
        threadTeam: null,
        defaultSetup: null,
        threadModel: { ...architect, options: [{ id: "effort", value: "high" }] },
      }),
    ).toEqual({
      architect: { ...architect, options: [{ id: "effort", value: "high" }] },
      workers: [{ ...architect, options: [{ id: "effort", value: "high" }] }],
      limits: DEFAULT_TEAM_LIMITS,
    });
  });
});

describe("team setup helpers", () => {
  it("allows six workers at most", () => {
    expect(canAddTeamWorker({ ...saved, workers: Array.from({ length: 5 }, () => worker) })).toBe(
      true,
    );
    expect(canAddTeamWorker({ ...saved, workers: Array.from({ length: 6 }, () => worker) })).toBe(
      false,
    );
  });

  it("counts lead guidance in UTF-8 bytes", () => {
    expect(leadGuidanceBytesLeft("")).toBe(1999);
    expect(leadGuidanceBytesLeft("ệ")).toBe(1996);
  });

  it("names the composer control after the team's size", () => {
    expect(teamControlName(null)).toBe("Team");
    expect(teamControlName({ ...saved, workers: [worker] })).toBe("Team, 1 worker");
    expect(teamControlName({ ...saved, workers: [worker, worker] })).toBe("Team, 2 workers");
  });

  it("counts the worker models that differ from the selected one", () => {
    const team = { ...saved, architect };
    const other = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" };
    expect(teamModelSuffix(null, architect)).toBeNull();
    expect(teamModelSuffix({ ...team, workers: [architect] }, architect)).toBeNull();
    expect(teamModelSuffix({ ...team, workers: [worker, worker] }, architect)).toBe("+1 model");
    expect(teamModelSuffix({ ...team, workers: [worker, other, architect] }, architect)).toBe(
      "+2 models",
    );
  });

  it("moves the architect to the model picked in the composer", () => {
    expect(
      teamWithArchitect(saved, {
        ...architect,
        options: [{ id: "effort", value: "high" }],
        accountChoice: "pinned",
      }),
    ).toEqual({
      ...saved,
      architect: { ...architect, options: [{ id: "effort", value: "high" }] },
    });
  });

  it("replaces a saved profile by id and appends a new one", () => {
    const first = { id: "review", name: "Review", setup: saved };
    const renamed = { ...first, name: "Reviewers" };
    const other = { id: "build", name: "Build", setup: saved };
    expect(upsertTeamProfile([first], renamed)).toEqual([renamed]);
    expect(upsertTeamProfile([first], other)).toEqual([first, other]);
  });
});

describe("draftTeam", () => {
  const off = { newThreads: false, autoNewThreads: false, defaultSetup: saved };
  const on = { newThreads: true, autoNewThreads: false, defaultSetup: saved };
  const auto = { newThreads: true, autoNewThreads: true, defaultSetup: saved };

  it("follows the new-thread default until the draft chooses", () => {
    expect(draftTeam(undefined, off)).toBeNull();
    expect(draftTeam(undefined, on)).toEqual(saved);
    expect(
      draftTeam(undefined, { newThreads: true, autoNewThreads: false, defaultSetup: null }),
    ).toBeNull();
  });

  it("leaves the choice to the judge while Auto is the new-thread default", () => {
    expect(draftTeam(undefined, auto)).toBe("auto");
    expect(decidedTeam(draftTeam(undefined, auto))).toBeNull();
    expect(draftTeam(undefined, { ...auto, defaultSetup: null })).toBeNull();
    expect(teamControlName("auto")).toBe("Team, auto");
  });

  it("lets an explicit team or single agent win over Auto", () => {
    const own: TeamSetup = { ...saved, architect };
    expect(draftTeam(own, auto)).toEqual(own);
    expect(draftTeam(null, auto)).toBeNull();
  });

  it("keeps the draft's own choice, a single agent included", () => {
    const own: TeamSetup = { ...saved, architect };
    expect(draftTeam(own, off)).toEqual(own);
    expect(draftTeam(null, on)).toBeNull();
  });
});

describe("teamSetupLabel", () => {
  const strong = { id: "strong", name: "Strong team", setup: saved };
  const other: TeamSetup = { architect, workers: [architect], limits: DEFAULT_TEAM_LIMITS };

  it("names the profile the setup matches even when none was picked", () => {
    expect(
      teamSetupLabel({
        setup: { ...saved },
        profiles: [strong],
        pickedId: null,
        defaultSetup: null,
      }),
    ).toEqual({ profileId: "strong", name: "Strong team" });
  });

  it("matches a setup whose keys were written in another order", () => {
    const reordered = { limits: saved.limits, workers: saved.workers, architect: saved.architect };
    expect(
      teamSetupLabel({ setup: reordered, profiles: [strong], pickedId: null, defaultSetup: null })
        .profileId,
    ).toBe("strong");
  });

  it("keeps the picked profile when two profiles hold the same setup", () => {
    const twin = { ...strong, id: "twin", name: "Twin" };
    expect(
      teamSetupLabel({
        setup: saved,
        profiles: [strong, twin],
        pickedId: "twin",
        defaultSetup: null,
      }),
    ).toEqual({ profileId: "twin", name: "Twin" });
  });

  it("drops the picked profile once the setup is edited away from it", () => {
    expect(
      teamSetupLabel({ setup: other, profiles: [strong], pickedId: "strong", defaultSetup: null }),
    ).toEqual({ profileId: null, name: "Unsaved setup" });
  });

  it("calls the saved default Default when no profile matches it", () => {
    expect(
      teamSetupLabel({ setup: other, profiles: [strong], pickedId: null, defaultSetup: other }),
    ).toEqual({ profileId: null, name: "Default" });
  });

  it("prefers a profile's name over Default when both match", () => {
    expect(
      teamSetupLabel({ setup: saved, profiles: [strong], pickedId: null, defaultSetup: saved })
        .name,
    ).toBe("Strong team");
  });
});
