import type { TeamWaitReason } from "@t3tools/contracts";

const listKeys = (keys: ReadonlyArray<string>) => keys.join(", ");

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
  /** Why a worker that ended while its team sat interrupted failed. */
  stoppedByRestart: "The app restarted while this worker ran.",
  /** The worker's brief, with the report size its architect reads. */
  workerTask: (task: string, summaryLimitBytes: number) =>
    `${task}\n\nEnd with a final report under ${summaryLimitBytes} bytes: what you changed, each check you ran with its result, and what is left open.`,
  startQueued: (keys: ReadonlyArray<string>) =>
    `Team: ${listKeys(keys)} can start now and start during your turn. Reply briefly and end the turn when nothing else needs you.`,
  continuePlan:
    "Continuing the plan: no worker is running and nothing is queued. Assign the next round with team_assign, or call team_finish if the work is done.",
  resumed: "The user resumed the team. Continue the plan from where it stopped.",
  restarted: (interrupted: ReadonlyArray<string>) =>
    interrupted.length === 0
      ? "The app restarted while the team ran, and the user resumed it. Continue the plan."
      : `The app restarted while the team ran, and the user resumed it. ${listKeys(interrupted)} stopped with the restart; assign them again with the same keys to retry, or give them up.`,
};
