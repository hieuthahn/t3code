import { CommandId, type ProjectId, type ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import type * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { teamMessage } from "./teamMessages.ts";
import type { TeamRunRow } from "./teamRows.ts";
import type { TeamStore } from "./teamStore.ts";
import { decideTeamTick } from "./teamSupervisor.ts";
import { planFor, type TeamWork } from "./teamWork.ts";

/** Looking after one running team per tick: start what fits, then handle stalls and silence. */
export const makeTeamWatch = (input: {
  readonly store: TeamStore;
  readonly work: TeamWork;
  readonly threads: ThreadManagementService.ThreadManagementService["Service"];
  readonly tell: (projectId: ProjectId, threadId: ThreadId, text: string) => Effect.Effect<void>;
  /** The architect run a wake followed, by team run, so one idle stretch gets one wake. */
  readonly wokeAfter: Map<string, string | null>;
}) => {
  const { store, work, threads, tell, wokeAfter } = input;
  /** When each watched thread last recorded an event, by its event sequence. */
  const seen = new Map<ThreadId, { readonly sequence: number; readonly at: number }>();
  const shellOf = (threadId: ThreadId) =>
    threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));

  const lastEventAt = (threadId: ThreadId, at: number) =>
    threads.getThreadEventSequence(threadId).pipe(
      Effect.orElseSucceed(() => -1),
      Effect.map((sequence) => {
        const previous = seen.get(threadId);
        if (previous !== undefined && previous.sequence === sequence) return previous.at;
        seen.set(threadId, { sequence, at });
        return at;
      }),
    );

  const interrupt = Effect.fn("Team.interruptSilent")(
    function* (run: TeamRunRow, threadId: ThreadId, at: number) {
      seen.set(threadId, { sequence: Number.NaN, at });
      const target = yield* shellOf(threadId);
      if (target === null) return;
      yield* threads.interruptThread({
        projectId: target.projectId,
        commandId: CommandId.make(`team:${run.run_id}:silent:${threadId}:${at}`),
        threadId,
        reason: "No activity for 20 minutes.",
      });
    },
    Effect.catchCause((cause) => Effect.logWarning("Could not stop a silent team turn", { cause })),
  );

  return Effect.fn("Team.watchRun")(function* (run: TeamRunRow) {
    const shell = yield* shellOf(run.thread_id);
    if (shell === null) return;
    const team = shell.team;
    if (team === undefined) {
      yield* store.updateRun(run, { status: "stopped", report: "The team was turned off." });
      return;
    }
    let current = yield* work.syncTasks(run, yield* store.assignmentsOf(run.run_id));
    if (run.status !== "running") return;
    const architectActive = shell.activeRunId !== null;
    let plan = planFor(run, team, current, architectActive);
    if (architectActive && plan.start.length > 0) {
      yield* work.startAssignments(run, team, current, plan.start);
      current = yield* store.assignmentsOf(run.run_id);
      plan = planFor(run, team, current, architectActive);
    }
    const fresh = (yield* store.latestRun(run.thread_id)) ?? run;
    const at = yield* Clock.currentTimeMillis;
    const workers = yield* Effect.forEach(
      current.flatMap((row) =>
        row.status === "running" && row.child_thread_id !== null ? [row.child_thread_id] : [],
      ),
      (threadId) =>
        Effect.gen(function* () {
          const child = yield* shellOf(threadId);
          return {
            threadId,
            hasActiveRun: child?.activeRunId != null,
            waitingOnUser: child?.pendingRuntimeRequest != null,
            lastEventSeenAt: yield* lastEventAt(threadId, at),
          };
        }),
    );
    const startable = [...plan.waits].flatMap(([key, reason]) =>
      reason._tag === "next_turn" ? [key] : [],
    );
    const actions = decideTeamTick({
      status: fresh.status,
      now: at,
      architect: {
        threadId: run.thread_id,
        hasActiveRun: architectActive,
        waitingOnUser: shell.pendingRuntimeRequest !== null,
        lastEventSeenAt: yield* lastEventAt(run.thread_id, at),
        latestRunId: shell.latestRunId,
      },
      workers,
      runningAssignments: current.filter((row) => row.status === "running").length,
      startableAssignments: startable.length,
      wokeForLatestRun:
        wokeAfter.has(run.run_id) && wokeAfter.get(run.run_id) === shell.latestRunId,
      openAssignments: current.filter((row) => row.status === "waiting").length,
      stalls: fresh.stalls,
      lastStallRunId: fresh.last_stall_run_id,
    });
    for (const action of actions) {
      switch (action.type) {
        case "wake_architect":
          wokeAfter.set(run.run_id, shell.latestRunId);
          yield* tell(shell.projectId, run.thread_id, teamMessage.startQueued(startable));
          break;
        case "continue_plan":
          yield* store.updateRun(fresh, { stalls: action.stalls, last_stall_run_id: action.runId });
          yield* tell(shell.projectId, run.thread_id, teamMessage.continuePlan);
          break;
        case "pause":
          yield* store.updateRun(fresh, {
            status: "paused",
            stalls: fresh.stalls + 1,
            last_stall_run_id: action.runId,
            report: action.report,
          });
          break;
        case "interrupt":
          yield* interrupt(run, action.threadId, at);
          break;
      }
    }
  });
};
