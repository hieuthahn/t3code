import {
  CommandId,
  MessageId,
  OrchestratorMcpFailure,
  TeamError,
  type OrchestratorMcpTeamAssignInput,
  type OrchestratorMcpTeamAssignResult,
  type OrchestratorMcpTeamFinishInput,
  type OrchestratorMcpTeamFinishResult,
  type ProjectId,
  type TeamRunView,
  type TeamThreadInput,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import type { McpInvocationScope } from "../mcp/McpInvocationContext.ts";
import * as OrchestratorMcpService from "../mcp/OrchestratorMcpService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { describeWait, teamMessage } from "./teamMessages.ts";
import { assignmentView, runView, type TeamRunRow } from "./teamRows.ts";
import { newAssignmentProblems } from "./teamScheduler.ts";
import { makeTeamStore, type NewTeamAssignment } from "./teamStore.ts";
import { makeTeamWatch } from "./teamWatch.ts";
import { makeTeamWork, planFor } from "./teamWork.ts";

export const TEAM_TICK_INTERVAL = Duration.seconds(2);

export class TeamService extends Context.Service<
  TeamService,
  {
    /** Add a round of assignments; outside autonomous mode the user approves them on a card first. */
    readonly assign: (
      scope: McpInvocationScope,
      input: OrchestratorMcpTeamAssignInput,
    ) => Effect.Effect<OrchestratorMcpTeamAssignResult, OrchestratorMcpFailure>;
    readonly finish: (
      scope: McpInvocationScope,
      input: OrchestratorMcpTeamFinishInput,
    ) => Effect.Effect<OrchestratorMcpTeamFinishResult, OrchestratorMcpFailure>;
    readonly view: (threadId: ThreadId) => Effect.Effect<TeamRunView | null, TeamError>;
    readonly subscribe: (threadId: ThreadId) => Stream.Stream<TeamRunView | null, TeamError>;
    readonly pause: (input: TeamThreadInput) => Effect.Effect<void, TeamError>;
    readonly resume: (input: TeamThreadInput) => Effect.Effect<void, TeamError>;
    readonly stop: (input: TeamThreadInput) => Effect.Effect<void, TeamError>;
    /** Look after every open team once: record finished workers, start work, handle stalls. */
    readonly tick: Effect.Effect<void>;
  }
>()("t3/team/TeamService") {}

const failure = (code: OrchestratorMcpFailure["code"], message: string) =>
  new OrchestratorMcpFailure({ code, message });
const asMcpFailure = (error: TeamError) => failure("orchestration_error", error.message);
const isOpen = (run: TeamRunRow | null): run is TeamRunRow =>
  run !== null && run.status !== "stopped" && run.status !== "finished";

/** Build the service; tests pass `tickEvery: null` and call `tick` themselves. */
export const layerWith = (options: { readonly tickEvery: Duration.Duration | null }) =>
  Layer.effect(
    TeamService,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const threads = yield* ThreadManagementService.ThreadManagementService;
      const orchestrator = yield* OrchestratorMcpService.OrchestratorMcpService;
      const crypto = yield* Crypto.Crypto;
      const changes = yield* PubSub.unbounded<ThreadId>();
      const lock = yield* Semaphore.make(1);
      const scope = yield* Effect.scope;
      const store = makeTeamStore(sql, changes);
      const work = makeTeamWork({ store, threads, orchestrator });
      const wokeAfter = new Map<string, string | null>();
      const awaitedMerges = new Map<string, ReadonlySet<string>>();
      const newId = crypto.randomUUIDv4().pipe(Effect.orDie);
      const shellOf = (threadId: ThreadId) =>
        threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));

      const tell = Effect.fn("Team.tell")(
        function* (projectId: ProjectId, threadId: ThreadId, text: string) {
          const id = `team:${yield* newId}`;
          yield* threads.sendToThread({
            projectId,
            commandId: CommandId.make(id),
            threadId,
            messageId: MessageId.make(`message:${id}`),
            text,
            attachments: [],
            mode: "auto",
            createdBy: "system",
            creationSource: "server",
          });
        },
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not message the architect", { cause }),
        ),
      );
      const watchRun = makeTeamWatch({ store, work, threads, tell, wokeAfter, awaitedMerges });

      const view: TeamService["Service"]["view"] = Effect.fn("Team.view")(function* (threadId) {
        const run = yield* store.latestRun(threadId);
        const shell = yield* shellOf(threadId);
        const team = shell?.team;
        if (run === null || team === undefined) return null;
        const current = yield* store.assignmentsOf(run.run_id);
        const plan = planFor(run, team, current, shell?.activeRunId != null);
        return runView({
          run,
          team,
          assignments: current.map((row) =>
            assignmentView(row, plan.waits.get(row.assignment_key), team.limits.summaryLimitBytes),
          ),
        });
      });

      const openRunFor = Effect.fn("Team.openRunFor")(function* (
        callerScope: McpInvocationScope & {
          readonly thread: NonNullable<McpInvocationScope["thread"]>;
        },
      ) {
        const latest = yield* store.latestRun(callerScope.thread.threadId);
        if (isOpen(latest)) return latest;
        yield* store.insertRun({
          runId: `team-run:${yield* newId}`,
          threadId: callerScope.thread.threadId,
          scope: callerScope,
        });
        const created = yield* store.latestRun(callerScope.thread.threadId);
        if (created === null) return yield* new TeamError({ message: "Could not open the team." });
        return created;
      });

      const assign: TeamService["Service"]["assign"] = Effect.fn("Team.assign")(
        function* (callerScope, input) {
          const thread = callerScope.thread;
          if (thread === undefined) {
            return yield* failure(
              "target_required",
              "team_assign needs an agent inside a T3 thread.",
            );
          }
          const shell = yield* shellOf(thread.threadId);
          const team = shell?.team;
          if (shell === null || team === undefined) {
            return yield* failure(
              "invalid_request",
              "This thread runs without a team. The user turns one on in the composer.",
            );
          }
          const outside = input.assignments.filter(
            (assignment) => team.workers[assignment.worker - 1] === undefined,
          );
          if (outside.length > 0) {
            return yield* failure(
              "invalid_request",
              `The team has ${team.workers.length} workers; ${outside.map((assignment) => assignment.key).join(", ")} name another number.`,
            );
          }
          const run = yield* openRunFor({ ...callerScope, thread }).pipe(
            Effect.mapError(asMcpFailure),
          );
          if (run.status !== "running") {
            return yield* failure(
              "invalid_request",
              "The team is paused. The user resumes it from the Team panel.",
            );
          }
          const existing = yield* store
            .assignmentsOf(run.run_id)
            .pipe(Effect.mapError(asMcpFailure));
          const problems = newAssignmentProblems({
            existing: existing.map((row) => ({
              key: row.assignment_key,
              status: row.status,
              attempts: row.attempts,
            })),
            incoming: input.assignments.map((assignment) => ({
              key: assignment.key,
              dependsOn: assignment.dependsOn ?? [],
            })),
            limits: team.limits,
            usage: { rounds: run.rounds, assignments: existing.length },
          });
          if (problems.length > 0) return yield* failure("invalid_request", problems.join(" "));

          const incoming = input.assignments.flatMap((assignment): Array<NewTeamAssignment> => {
            const worker = team.workers[assignment.worker - 1];
            if (worker === undefined) return [];
            const readOnly = assignment.readOnly ?? false;
            return [
              {
                key: assignment.key,
                title: assignment.title,
                task: assignment.task,
                instanceId: worker.instanceId,
                model: worker.model,
                options: worker.options ?? [],
                dependsOn: assignment.dependsOn ?? [],
                readOnly,
                files: assignment.files ?? [],
                isolation: assignment.isolation ?? (readOnly ? "shared" : "worktree"),
              },
            ];
          });
          const workerOf = (key: string) => {
            const worker = input.assignments.find((assignment) => assignment.key === key)?.worker;
            return worker === undefined ? {} : { worker };
          };
          const closeReason = store.latestRun(thread.threadId).pipe(
            Effect.map((latest) =>
              latest?.run_id === run.run_id && isOpen(latest)
                ? undefined
                : teamMessage.stoppedByUser,
            ),
            Effect.orElseSucceed(() => undefined),
          );
          const decision =
            team.autonomous === true
              ? {
                  status: "approved" as const,
                  approvedKeys: incoming.map((item) => item.key),
                  declinedKeys: [],
                  recordLaunches: () => Effect.void,
                }
              : yield* orchestrator.askChildPlan(callerScope, {
                  reason: input.reason,
                  closeReason,
                  clientRequestId: `team:${run.run_id}:round:${run.rounds + 1}`,
                  tasks: incoming.map((item) => ({
                    key: item.key,
                    ...workerOf(item.key),
                    title: item.title,
                    task: item.task,
                    isolation: item.isolation,
                    target: {
                      providerInstanceId: item.instanceId,
                      model: item.model,
                      options: item.options,
                    },
                  })),
                });
          const declinedKeys = [...decision.declinedKeys];
          const approved = incoming.filter((item) => decision.approvedKeys.includes(item.key));
          return yield* lock
            .withPermits(1)(
              Effect.gen(function* () {
                const fresh = yield* store.latestRun(thread.threadId);
                if (fresh === null || fresh.run_id !== run.run_id || !isOpen(fresh)) {
                  if (approved.length > 0) {
                    yield* decision.recordLaunches(
                      approved.map((item) => ({
                        key: item.key,
                        failure: teamMessage.stoppedByUser,
                      })),
                    );
                  }
                  return yield* failure("invalid_request", teamMessage.stoppedByUser);
                }
                if (decision.status === "timed_out" || decision.status === "cancelled") {
                  return {
                    status: decision.status,
                    started: [],
                    waiting: [],
                    failed: [],
                    declinedKeys,
                  };
                }
                if (approved.length === 0) {
                  return {
                    status: "declined" as const,
                    started: [],
                    waiting: [],
                    failed: [],
                    declinedKeys,
                  };
                }
                yield* store.queueAssignments(fresh, existing, approved);
                yield* store.updateRun(fresh, { rounds: fresh.rounds + 1, stalls: 0 });
                const current = yield* store.assignmentsOf(run.run_id);
                const plan = planFor(fresh, team, current, true);
                const { started, failed } = yield* work.startAssignments(
                  fresh,
                  team,
                  current,
                  plan.start,
                );
                return {
                  status: "queued" as const,
                  started,
                  failed,
                  declinedKeys,
                  waiting: approved.flatMap((item) => {
                    const reason = plan.waits.get(item.key);
                    return reason === undefined
                      ? []
                      : [{ key: item.key, reason: describeWait(reason) }];
                  }),
                };
              }),
            )
            .pipe(
              Effect.mapError((error) =>
                error._tag === "TeamError" ? asMcpFailure(error) : error,
              ),
            );
        },
      );

      const finish: TeamService["Service"]["finish"] = Effect.fn("Team.finish")(
        function* (callerScope, input) {
          const threadId = callerScope.thread?.threadId;
          if (threadId === undefined) {
            return yield* failure(
              "target_required",
              "team_finish needs an agent inside a T3 thread.",
            );
          }
          const run = yield* store.latestRun(threadId).pipe(Effect.mapError(asMcpFailure));
          if (!isOpen(run)) {
            return yield* failure("invalid_request", "This thread has no open team to finish.");
          }
          yield* lock
            .withPermits(1)(
              Effect.gen(function* () {
                const current = yield* store.assignmentsOf(run.run_id);
                const running = current.filter((row) => row.status === "running");
                if (running.length > 0) {
                  return yield* failure(
                    "invalid_request",
                    `${running.map((row) => row.assignment_key).join(", ")} still run. Wait for them, or let the user stop the team.`,
                  );
                }
                for (const row of current.filter((candidate) => candidate.status === "waiting")) {
                  yield* store.updateAssignment(run, row, { status: "cancelled" });
                }
                yield* store.updateRun(run, { status: "finished", summary: input.summary });
              }),
            )
            .pipe(
              Effect.mapError((error) =>
                error._tag === "TeamError" ? asMcpFailure(error) : error,
              ),
            );
          return { status: "finished" as const };
        },
      );

      const openRunOf = (threadId: ThreadId) =>
        store
          .latestRun(threadId)
          .pipe(
            Effect.flatMap((run) =>
              isOpen(run)
                ? Effect.succeed(run)
                : Effect.fail(new TeamError({ message: "This thread has no open team." })),
            ),
          );

      const pause: TeamService["Service"]["pause"] = Effect.fn("Team.pause")(function* (input) {
        const run = yield* openRunOf(input.threadId);
        if (run.status !== "running") return;
        yield* lock.withPermits(1)(store.updateRun(run, { status: "paused", report: null }));
      });

      const resume: TeamService["Service"]["resume"] = Effect.fn("Team.resume")(function* (input) {
        const run = yield* openRunOf(input.threadId);
        if (run.status === "running") return;
        const shell = yield* shellOf(input.threadId);
        if (shell === null) return yield* new TeamError({ message: "The team's thread is gone." });
        const current = yield* lock.withPermits(1)(
          Effect.gen(function* () {
            const synced = yield* work.syncTasks(run, yield* store.assignmentsOf(run.run_id));
            yield* store.updateRun(run, {
              status: "running",
              report: null,
              stalls: 0,
              last_stall_run_id: shell.latestRunId,
            });
            return synced;
          }),
        );
        wokeAfter.set(run.run_id, shell.latestRunId);
        if (shell.activeRunId !== null) return;
        const stoppedByRestart = current
          .filter(
            (row) =>
              row.status === "running" ||
              (row.status === "failed" && row.failure === teamMessage.stoppedByRestart),
          )
          .map((row) => row.assignment_key);
        yield* tell(
          shell.projectId,
          run.thread_id,
          run.status === "interrupted"
            ? teamMessage.restarted(stoppedByRestart)
            : teamMessage.resumed,
        );
      });

      const stop: TeamService["Service"]["stop"] = Effect.fn("Team.stop")(function* (input) {
        const run = yield* openRunOf(input.threadId);
        yield* lock.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* work.syncTasks(run, yield* store.assignmentsOf(run.run_id));
            for (const row of current) {
              if (row.status === "waiting" || row.status === "running") {
                yield* store.updateAssignment(run, row, { status: "cancelled" });
              }
            }
            yield* store.updateRun(run, {
              status: "stopped",
              report: teamMessage.stoppedByUser,
            });
          }),
        );
        yield* threads
          .stopDelegatedTasks({
            threadId: run.thread_id,
            commandId: CommandId.make(`team:${run.run_id}:stop`),
            reason: teamMessage.stoppedByUser,
          })
          .pipe(
            Effect.mapError(
              (cause) => new TeamError({ message: "Could not stop the team's workers.", cause }),
            ),
          );
      });

      const openRuns = Effect.forEach(["running", "paused", "interrupted"] as const, (status) =>
        store.runsWithStatus(status),
      ).pipe(Effect.map((groups) => groups.flat()));

      const tick: TeamService["Service"]["tick"] = lock
        .withPermits(1)(
          openRuns.pipe(
            Effect.flatMap((runs) =>
              Effect.forEach(runs, (run) =>
                watchRun(run).pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("Could not look after a team", { runId: run.run_id, cause }),
                  ),
                ),
              ),
            ),
          ),
        )
        .pipe(
          Effect.asVoid,
          Effect.catchCause((cause) => Effect.logWarning("The team supervisor failed", { cause })),
        );

      const subscribe: TeamService["Service"]["subscribe"] = (threadId) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(changes);
            return Stream.concat(
              Stream.fromEffect(view(threadId)),
              Stream.fromSubscription(subscription).pipe(
                Stream.filter((changed) => changed === threadId),
                Stream.mapEffect(() => view(threadId)),
              ),
            );
          }),
        );

      const cutByRestart = yield* store
        .runsWithStatus("running")
        .pipe(Effect.orElseSucceed(() => []));
      for (const run of cutByRestart) {
        yield* store
          .updateRun(run, {
            status: "interrupted",
            report: "The app restarted while the team ran. Resume it to continue.",
          })
          .pipe(Effect.ignore);
      }
      if (options.tickEvery !== null) {
        yield* Effect.forkIn(Effect.repeat(tick, Schedule.spaced(options.tickEvery)), scope);
      }

      return TeamService.of({ assign, finish, view, subscribe, pause, resume, stop, tick });
    }),
  );

export const layer = layerWith({ tickEvery: TEAM_TICK_INTERVAL });
