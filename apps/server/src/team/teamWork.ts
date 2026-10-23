import {
  TeamError,
  type OrchestrationV2Subagent,
  type OrchestratorMcpTeamAssignResult,
  type TeamAssignmentStatus,
  type TeamSetup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as OrchestratorMcpService from "../mcp/OrchestratorMcpService.ts";
import type * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { teamMessage } from "./teamMessages.ts";
import {
  callerScopeOf,
  scheduledFrom,
  type TeamAssignmentRow,
  type TeamRunRow,
} from "./teamRows.ts";
import { planTeamStarts } from "./teamScheduler.ts";
import type { TeamStore } from "./teamStore.ts";

const settledStatus = (
  status: OrchestrationV2Subagent["status"],
): TeamAssignmentStatus | undefined => {
  switch (status) {
    case "completed":
      return "done";
    case "failed":
    case "interrupted":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return undefined;
  }
};

export const planFor = (
  run: TeamRunRow,
  team: TeamSetup,
  current: ReadonlyArray<TeamAssignmentRow>,
  architectActive: boolean,
) =>
  planTeamStarts({
    assignments: current.map(scheduledFrom),
    maxParallel: team.limits.maxParallel,
    paused: run.status !== "running",
    architectActive,
  });

/** Reading the architect's task records and starting workers as the architect. */
export const makeTeamWork = (input: {
  readonly store: TeamStore;
  readonly threads: ThreadManagementService.ThreadManagementService["Service"];
  readonly orchestrator: OrchestratorMcpService.OrchestratorMcpService["Service"];
}) => {
  const { store, threads, orchestrator } = input;

  /** Record workers that ended, from the architect's own task records; returns fresh rows. */
  const syncTasks = Effect.fn("Team.syncTasks")(function* (
    run: TeamRunRow,
    current: ReadonlyArray<TeamAssignmentRow>,
  ) {
    const running = current.filter((row) => row.status === "running" && row.task_id !== null);
    if (running.length === 0) return current;
    const records = yield* threads
      .getThreadRecords(run.thread_id, ["subagents"])
      .pipe(
        Effect.mapError(
          (cause) => new TeamError({ message: "Could not read the team's tasks.", cause }),
        ),
      );
    let settled = false;
    for (const row of running) {
      const task = records.subagents.find((candidate) => candidate.id === row.task_id);
      const status = task === undefined ? undefined : settledStatus(task.status);
      if (task === undefined || status === undefined) continue;
      settled = true;
      yield* store.updateAssignment(run, row, {
        status,
        result: task.result,
        failure:
          status !== "failed"
            ? null
            : run.status === "interrupted"
              ? teamMessage.stoppedByRestart
              : (task.result ?? `The worker ended as ${task.status}.`),
      });
    }
    if (!settled) return current;
    yield* store.updateRun(run, { stalls: 0 });
    return yield* store.assignmentsOf(run.run_id);
  });

  const startAssignments = Effect.fn("Team.startAssignments")(function* (
    run: TeamRunRow,
    team: TeamSetup,
    current: ReadonlyArray<TeamAssignmentRow>,
    keys: ReadonlyArray<string>,
  ) {
    const started: Array<OrchestratorMcpTeamAssignResult["started"][number]> = [];
    const failed: Array<OrchestratorMcpTeamAssignResult["failed"][number]> = [];
    for (const key of keys) {
      const row = current.find((candidate) => candidate.assignment_key === key);
      if (row === undefined) continue;
      const attempts = row.attempts + 1;
      const outcome = yield* orchestrator
        .delegateTeamTask(callerScopeOf(run), {
          task: teamMessage.workerTask(row.task, team.limits.summaryLimitBytes),
          title: row.title,
          isolation: row.isolation,
          target: {
            providerInstanceId: row.instance_id,
            model: row.model,
            options: row.options_json,
          },
          mode: "async",
          clientRequestId: `team:${run.run_id}:${key}:${attempts}`,
        })
        .pipe(Effect.result);
      if (outcome._tag === "Success") {
        yield* store.updateAssignment(run, row, {
          status: "running",
          attempts,
          task_id: outcome.success.taskId,
          child_thread_id: outcome.success.childThreadId,
        });
        started.push({
          key,
          taskId: outcome.success.taskId,
          childThreadId: outcome.success.childThreadId,
        });
      } else {
        yield* store.updateAssignment(run, row, {
          status: "failed",
          attempts,
          failure: outcome.failure.message,
        });
        failed.push({ key, message: outcome.failure.message });
      }
    }
    if (started.length > 0) yield* store.updateRun(run, { stalls: 0 });
    return { started, failed };
  });

  return { syncTasks, startAssignments };
};

export type TeamWork = ReturnType<typeof makeTeamWork>;
