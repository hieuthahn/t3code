import type { TeamAssignmentView, TeamRunView, TeamWaitReason } from "@t3tools/contracts";

const listKeys = (keys: ReadonlyArray<string>) => keys.join(", ");

/** What a waiting assignment needs, in the panel's words. */
export function teamWaitText(reason: TeamWaitReason): string {
  switch (reason._tag) {
    case "dependency":
      return `waits for ${listKeys(reason.keys)}`;
    case "dependency_failed":
      return `blocked: ${listKeys(reason.keys)} failed`;
    case "write_scope":
      return reason.files.length === 0
        ? `waits for ${reason.key} to finish writing the checkout`
        : `waits for ${reason.key} to finish writing ${reason.files.join(", ")}`;
    case "account_busy":
      return `waits for a free ${reason.instanceId} slot`;
    case "team_parallel":
      return `waits for a free slot (${reason.limit} at once)`;
    case "team_paused":
      return "waits for Resume";
    case "next_turn":
      return "starts on the architect's next turn";
  }
}

export function teamAssignmentStatusText(assignment: TeamAssignmentView): string {
  switch (assignment.status) {
    case "waiting":
      return assignment.waitReason === null ? "waiting" : teamWaitText(assignment.waitReason);
    case "running":
      return assignment.attempts > 1 ? `running, attempt ${assignment.attempts}` : "running";
    case "done":
      return "done";
    case "failed":
      return assignment.failure === null ? "failed" : `failed: ${assignment.failure}`;
    case "cancelled":
      return "cancelled";
  }
}

export const TEAM_RUN_STATUS_TEXT: Record<TeamRunView["status"], string> = {
  running: "Running",
  paused: "Paused",
  interrupted: "Interrupted by a restart",
  stopped: "Stopped",
  finished: "Finished",
};

/** Round and assignment usage against the team's limits. */
export function teamUsageText(run: TeamRunView): string {
  return `Round ${run.usage.rounds}/${run.limits.maxRounds} · ${run.usage.assignments}/${run.limits.maxAssignments} assignments`;
}
