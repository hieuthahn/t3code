export const DEFAULT_SLACK_REVIEW_ASSIGNEES = "@ort-internal";

/** Name a project after its repository: "hora-skills-ort-furo" reads "Hora Skills Ort Furo". */
export function projectNameFromRepository(repository: string): string {
  const name = repository.slice(repository.lastIndexOf("/") + 1);
  return name
    .split("-")
    .filter((word) => word.length > 0)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

/** Join Slack handles with single spaces, each starting with "@". */
export function normalizeSlackAssignees(input: string): string {
  return input
    .split(/\s+/)
    .filter((handle) => handle.length > 0)
    .map((handle) => (handle.startsWith("@") ? handle : `@${handle}`))
    .join(" ");
}

/** Write the four-line review request the #--tasks channel expects. */
export function buildSlackReviewMessage(input: {
  readonly project: string;
  readonly title: string;
  readonly assignees: string;
  readonly url: string;
}): string {
  return [
    `[Project] ${input.project.trim()}`,
    `[Task] review: ${input.title.trim()}`,
    `[Assignee] ${normalizeSlackAssignees(input.assignees)}`,
    `[Reference] ${input.url}`,
  ].join("\n");
}
