import { TeamError, type ProviderInstanceId, type ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import type * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import {
  type TeamMerge,
  decodeAssignmentRows,
  decodeRunRows,
  encodeCallerScope,
  encodeOptions,
  encodeStrings,
  storedCallerScope,
  type TeamAssignmentRow,
  type TeamRunRow,
} from "./teamRows.ts";

type Fields = Record<string, string | number | null>;

export interface NewTeamAssignment {
  readonly key: string;
  readonly title: string;
  readonly task: string;
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly options: TeamAssignmentRow["options_json"];
  readonly dependsOn: ReadonlyArray<string>;
  readonly readOnly: boolean;
  readonly files: ReadonlyArray<string>;
  readonly isolation: TeamAssignmentRow["isolation"];
}

/** The team tables; every write tells subscribers which architect thread changed. */
export const makeTeamStore = (sql: SqlClient.SqlClient, changes: PubSub.PubSub<ThreadId>) => {
  const teamError = (message: string) => (cause: unknown) => new TeamError({ message, cause });
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const read = <A>(
    query: Effect.Effect<ReadonlyArray<unknown>, SqlError>,
    decode: (input: unknown) => Effect.Effect<A, unknown>,
  ) => query.pipe(Effect.flatMap(decode), Effect.mapError(teamError("Could not read the team.")));
  const write = (query: Effect.Effect<unknown, SqlError>, threadId: ThreadId) =>
    query.pipe(
      Effect.mapError(teamError("Could not save the team.")),
      Effect.andThen(PubSub.publish(changes, threadId)),
      Effect.asVoid,
    );

  const latestRun = (threadId: ThreadId) =>
    read(
      sql`SELECT * FROM team_runs WHERE thread_id = ${threadId} ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      decodeRunRows,
    ).pipe(Effect.map((found): TeamRunRow | null => found[0] ?? null));

  const runsWithStatus = (status: TeamRunRow["status"]) =>
    read(sql`SELECT * FROM team_runs WHERE status = ${status}`, decodeRunRows);

  const mergesOf = (threadId: ThreadId) =>
    sql<TeamMerge>`SELECT item_id, child_title, status FROM merge_queue_items
      WHERE owner_thread_id = ${threadId}`.pipe(
      Effect.mapError(teamError("Could not read the merge queue.")),
    );

  const assignmentsOf = (runId: string) =>
    read(
      sql`SELECT * FROM team_assignments WHERE run_id = ${runId} ORDER BY ordinal`,
      decodeAssignmentRows,
    );

  const insertRun = Effect.fn("TeamStore.insertRun")(function* (input: {
    readonly runId: string;
    readonly threadId: ThreadId;
    readonly scope: Parameters<typeof storedCallerScope>[0];
  }) {
    const at = yield* now;
    yield* write(
      sql`INSERT INTO team_runs ${sql.insert({
        run_id: input.runId,
        thread_id: input.threadId,
        status: "running",
        rounds: 0,
        stalls: 0,
        caller_scope_json: encodeCallerScope(storedCallerScope(input.scope)),
        created_at: at,
        updated_at: at,
      })}`,
      input.threadId,
    );
  });

  /** Queue new keys and put failed ones back in line; returns nothing, the caller re-reads. */
  const queueAssignments = Effect.fn("TeamStore.queueAssignments")(function* (
    run: TeamRunRow,
    existing: ReadonlyArray<TeamAssignmentRow>,
    incoming: ReadonlyArray<NewTeamAssignment>,
  ) {
    const at = yield* now;
    let ordinal = existing.reduce((highest, row) => Math.max(highest, row.ordinal), 0);
    for (const assignment of incoming) {
      const fields = {
        title: assignment.title,
        task: assignment.task,
        instance_id: assignment.instanceId,
        model: assignment.model,
        options_json: encodeOptions(assignment.options),
        depends_on_json: encodeStrings(assignment.dependsOn),
        read_only: assignment.readOnly ? 1 : 0,
        files_json: encodeStrings(assignment.files),
        isolation: assignment.isolation,
        status: "waiting",
        task_id: null,
        child_thread_id: null,
        failure: null,
        result: null,
        updated_at: at,
      };
      const previous = existing.find((row) => row.assignment_key === assignment.key);
      if (previous === undefined) {
        ordinal += 1;
        yield* write(
          sql`INSERT INTO team_assignments ${sql.insert({
            ...fields,
            run_id: run.run_id,
            assignment_key: assignment.key,
            ordinal,
            attempts: 0,
            created_at: at,
          })}`,
          run.thread_id,
        );
      } else {
        yield* write(
          sql`UPDATE team_assignments SET ${sql.update(fields)}
            WHERE run_id = ${run.run_id} AND assignment_key = ${assignment.key}`,
          run.thread_id,
        );
      }
    }
  });

  const updateRun = Effect.fn("TeamStore.updateRun")(function* (run: TeamRunRow, fields: Fields) {
    yield* write(
      sql`UPDATE team_runs SET ${sql.update({ ...fields, updated_at: yield* now })}
        WHERE run_id = ${run.run_id}`,
      run.thread_id,
    );
  });

  const updateAssignment = Effect.fn("TeamStore.updateAssignment")(function* (
    run: TeamRunRow,
    row: TeamAssignmentRow,
    fields: Fields,
  ) {
    yield* write(
      sql`UPDATE team_assignments SET ${sql.update({ ...fields, updated_at: yield* now })}
        WHERE run_id = ${row.run_id} AND assignment_key = ${row.assignment_key}`,
      run.thread_id,
    );
  });

  return {
    latestRun,
    runsWithStatus,
    assignmentsOf,
    mergesOf,
    insertRun,
    queueAssignments,
    updateRun,
    updateAssignment,
  };
};

export type TeamStore = ReturnType<typeof makeTeamStore>;
