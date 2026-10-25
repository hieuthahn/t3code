import {
  DEFAULT_TEAM_LIMITS,
  TEAM_LEAD_GUIDANCE_MAX_BYTES,
  TEAM_MAX_WORKERS,
  utf8ByteLength,
  type ModelSelection,
  type TeamMember,
  type TeamProfile,
  type TeamSetup,
} from "@t3tools/contracts";

export function teamMemberFromSelection(selection: ModelSelection): TeamMember {
  return {
    instanceId: selection.instanceId,
    model: selection.model,
    ...(selection.options === undefined || selection.options.length === 0
      ? {}
      : { options: [...selection.options] }),
  };
}

/** The setup the popover opens with: the thread's own, the saved default, or one built from its model. */
export function initialTeamSetup(input: {
  readonly threadTeam: TeamSetup | null;
  readonly defaultSetup: TeamSetup | null;
  readonly threadModel: ModelSelection;
}): TeamSetup {
  if (input.threadTeam !== null) return input.threadTeam;
  const architect = teamMemberFromSelection(input.threadModel);
  if (input.defaultSetup !== null) return { ...input.defaultSetup, architect };
  return { architect, workers: [architect], limits: DEFAULT_TEAM_LIMITS };
}

/** A draft's team: its own choice, else the team new threads start with. */
export function draftTeam(
  choice: TeamSetup | null | undefined,
  settings: { readonly newThreads: boolean; readonly defaultSetup: TeamSetup | null },
): TeamSetup | null {
  if (choice !== undefined) return choice;
  return settings.newThreads ? settings.defaultSetup : null;
}

export const canAddTeamWorker = (setup: TeamSetup) => setup.workers.length < TEAM_MAX_WORKERS;

export const leadGuidanceBytesLeft = (guidance: string) =>
  TEAM_LEAD_GUIDANCE_MAX_BYTES - 1 - utf8ByteLength(guidance);

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The composer control's accessible name: how many workers a running team has. */
export function teamControlName(team: TeamSetup | null): string {
  return team === null ? "Team" : `Team, ${plural(team.workers.length, "worker")}`;
}

/** What the model picker adds after the architect: the worker models other than the one shown. */
export function teamModelSuffix(team: TeamSetup | null, shown: ModelSelection): string | null {
  if (team === null) return null;
  const others = new Set(
    team.workers
      .filter((worker) => worker.instanceId !== shown.instanceId || worker.model !== shown.model)
      .map((worker) => `${worker.instanceId}\u0000${worker.model}`),
  );
  return others.size === 0 ? null : `+${plural(others.size, "model")}`;
}

export const teamWithArchitect = (team: TeamSetup, selection: ModelSelection): TeamSetup => ({
  ...team,
  architect: teamMemberFromSelection(selection),
});

export function upsertTeamProfile(
  profiles: ReadonlyArray<TeamProfile>,
  profile: TeamProfile,
): ReadonlyArray<TeamProfile> {
  const index = profiles.findIndex((candidate) => candidate.id === profile.id);
  return index === -1
    ? [...profiles, profile]
    : profiles.map((candidate, at) => (at === index ? profile : candidate));
}
