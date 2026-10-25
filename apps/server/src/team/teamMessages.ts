import type { TeamWaitReason } from "@t3tools/contracts";

import type { TeamMerge } from "./teamRows.ts";

const listKeys = (keys: ReadonlyArray<string>) => keys.join(", ");

const mergeOutcome = (merge: TeamMerge) => {
  if (merge.status === "merged") return `${merge.child_title} merged`;
  if (merge.status === "cancelled") return `${merge.child_title} removed by the user`;
  return `${merge.child_title} failed to land and its child was told why`;
};

/** One sentence on what a waiting assignment needs, for the architect and the panel. */
export function describeWait(reason: TeamWaitReason): string {
  switch (reason._tag) {
    case "dependency":
      return `Waits for ${listKeys(reason.keys)} to finish.`;
    case "dependency_failed":
      return `Blocked: ${listKeys(reason.keys)} failed. Retry it or give this up.`;
    case "write_scope":
      return reason.files.length === 0
        ? `Waits for ${reason.key}, which writes the whole shared checkout.`
        : `Waits for ${reason.key} to finish writing ${reason.files.join(", ")}.`;
    case "account_busy":
      return `Waits for a free slot on ${reason.instanceId}, which runs ${reason.running} workers.`;
    case "team_parallel":
      return `Waits for a free slot; the team runs ${reason.limit} at once.`;
    case "team_paused":
      return "Waits for the user to resume the team.";
    case "next_turn":
      return "Starts on your next turn.";
  }
}

export const teamMessage = {
  /** Why an architect's own delegation or thread launch is refused. */
  assignThroughTeam:
    "This thread runs a team. Give work to its workers with team_assign, which keeps the team's limits.",
  /** Why a worker that ended while its team sat interrupted failed. */
  stoppedByRestart: "The app restarted while this worker ran.",
  stoppedByUser: "The user stopped the team.",
  /** The worker's brief, with the report size its architect reads. */
  workerTask: (task: string, summaryLimitBytes: number) =>
    `${task}\n\nEnd with a final report under ${summaryLimitBytes} bytes: what you changed, each check you ran with its result, and what is left open.`,
  startQueued: (keys: ReadonlyArray<string>) =>
    `Team: ${listKeys(keys)} can start now and start during your turn. Reply briefly and end the turn when nothing else needs you.`,
  continuePlan:
    "Continuing the plan: no worker is running and no assignment is waiting to start. Assign the next round with team_assign, or call team_finish if the work is done.",
  mergesSettled: (merges: ReadonlyArray<TeamMerge>) =>
    `Team: ${merges.map(mergeOutcome).join("; ")}. Assign the next round with team_assign, or call team_finish if the work is done.`,
  replacedByNewerRound: "Replaced by a newer proposal.",
  roundDeclined: (keys: ReadonlyArray<string>) =>
    `Team: the user declined ${listKeys(keys)}. Assign another round with team_assign, or call team_finish if the work is done.`,
  roundRefused: (problems: ReadonlyArray<string>) =>
    `Team: the user approved the round, but it could not join the team. ${problems.join(" ")} Assign it again with team_assign.`,
  resumed: "The user resumed the team. Continue the plan from where it stopped.",
  restarted: (interrupted: ReadonlyArray<string>) =>
    interrupted.length === 0
      ? "The app restarted while the team ran, and the user resumed it. Continue the plan."
      : `The app restarted while the team ran, and the user resumed it. ${listKeys(interrupted)} stopped with the restart; assign them again with the same keys to retry, or give them up.`,
};
