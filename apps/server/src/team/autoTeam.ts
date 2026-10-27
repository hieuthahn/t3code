import type { ModelSelection, TeamSettings, TeamSetup } from "@t3tools/contracts";

export interface AutoTeam {
  readonly setup: TeamSetup;
  /** The saved profile the default setup matches, for the notice. */
  readonly name: string | undefined;
}

/** The default setup with the thread's own model as architect, or nothing when none is saved. */
export function autoTeamSetup(
  settings: TeamSettings | undefined,
  modelSelection: ModelSelection,
): AutoTeam | undefined {
  const defaultSetup = settings?.defaultSetup ?? null;
  if (defaultSetup === null) return undefined;
  const name = settings?.profiles.find(
    (profile) => JSON.stringify(profile.setup) === JSON.stringify(defaultSetup),
  )?.name;
  const { instanceId, model, options } = modelSelection;
  const architect = {
    instanceId,
    model,
    ...(options === undefined || options.length === 0 ? {} : { options: [...options] }),
  };
  return { setup: { ...defaultSetup, architect }, name };
}

const ANSWER_ALONE_HINT =
  "[Team Auto: this message looks like a question or a small task. Handle it yourself without team_assign, unless it turns out to need workers.]";

/** Adds the per-message hint to the provider text only, so the system prompt and its cache stay. */
export function withAnswerAloneHint(text: string): string {
  return `${text}\n\n${ANSWER_ALONE_HINT}`;
}
