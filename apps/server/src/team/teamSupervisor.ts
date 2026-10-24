import { TEAM_SILENCE_LIMIT_MS, type TeamRunStatus } from "@t3tools/contracts";

export interface WatchedThread<Id extends string = string> {
  readonly threadId: Id;
  readonly hasActiveRun: boolean;
  readonly waitingOnUser: boolean;
  /** When this thread last recorded an event, as far as the team has seen. */
  readonly lastEventSeenAt: number;
}

export interface TeamTick<Id extends string = string> {
  readonly status: TeamRunStatus;
  readonly now: number;
  readonly architect: WatchedThread<Id> & { readonly latestRunId: string | null };
  readonly workers: ReadonlyArray<WatchedThread<Id>>;
  readonly runningAssignments: number;
  readonly startableAssignments: number;
  /** A wake already went out after the architect's latest run. */
  readonly wokeForLatestRun: boolean;
  readonly openAssignments: number;
  /** Merges the architect enqueued that still wait for the user or the queue. */
  readonly openMerges: number;
  /** Merges the architect waited on that landed, failed or were removed since it last heard. */
  readonly settledMerges: number;
  readonly stalls: number;
  /** The architect run the last stall was counted for, so one run never counts twice. */
  readonly lastStallRunId: string | null;
}

export type TeamAction<Id extends string = string> =
  | { readonly type: "wake_architect"; readonly reason: "start_queued" | "merges_settled" }
  | { readonly type: "continue_plan"; readonly stalls: number; readonly runId: string | null }
  | { readonly type: "pause"; readonly report: string; readonly runId: string | null }
  | { readonly type: "interrupt"; readonly threadId: Id };

const silent = (thread: WatchedThread, now: number) =>
  thread.hasActiveRun &&
  !thread.waitingOnUser &&
  now - thread.lastEventSeenAt >= TEAM_SILENCE_LIMIT_MS;

/** Decide what a running team needs from the app on this tick. */
export function decideTeamTick<Id extends string>(
  tick: TeamTick<Id>,
): ReadonlyArray<TeamAction<Id>> {
  if (tick.status !== "running") return [];
  const interrupts: Array<TeamAction<Id>> = [tick.architect, ...tick.workers]
    .filter((thread) => silent(thread, tick.now))
    .map((thread) => ({ type: "interrupt", threadId: thread.threadId }));
  const { architect } = tick;
  if (architect.hasActiveRun || architect.waitingOnUser) return interrupts;
  if (tick.startableAssignments > 0) {
    return tick.wokeForLatestRun
      ? interrupts
      : [...interrupts, { type: "wake_architect", reason: "start_queued" }];
  }
  if (tick.runningAssignments > 0 || tick.openMerges > 0 || tick.wokeForLatestRun) {
    return interrupts;
  }
  if (tick.settledMerges > 0) {
    return [...interrupts, { type: "wake_architect", reason: "merges_settled" }];
  }
  if (architect.latestRunId === tick.lastStallRunId) return interrupts;
  if (tick.stalls === 0) {
    return [...interrupts, { type: "continue_plan", stalls: 1, runId: architect.latestRunId }];
  }
  const report =
    tick.openAssignments > 0
      ? `The architect stopped twice while ${tick.openAssignments} assignments could not start. The team paused; resume it after you check the plan.`
      : "The architect stopped twice without finishing the team. The team paused; resume it to continue, or stop it.";
  return [...interrupts, { type: "pause", report, runId: architect.latestRunId }];
}
