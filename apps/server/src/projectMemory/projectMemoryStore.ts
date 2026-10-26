import {
  ProjectMemoryError,
  type ProjectId,
  type ProjectMemoryEntry,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import type * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

interface EntryRow {
  readonly entry_id: string;
  readonly project_id: string;
  readonly text: string;
  readonly author_thread_id: string | null;
  readonly author_title: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const entryOf = (row: EntryRow): ProjectMemoryEntry =>
  ({
    id: row.entry_id,
    projectId: row.project_id,
    text: row.text,
    ...(row.author_thread_id === null ? {} : { authorThreadId: row.author_thread_id }),
    ...(row.author_title === null ? {} : { authorThreadTitle: row.author_title }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) as ProjectMemoryEntry;

/** The project memory table; every write tells subscribers which project changed. */
export const makeProjectMemoryStore = (
  sql: SqlClient.SqlClient,
  changes: PubSub.PubSub<ProjectId>,
) => {
  const memoryError = (message: string) => (cause: unknown) =>
    new ProjectMemoryError({ message, cause });
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const read = (query: Effect.Effect<ReadonlyArray<EntryRow>, SqlError>) =>
    query.pipe(
      Effect.map((rows) => rows.map(entryOf)),
      Effect.mapError(memoryError("Could not read the project memory.")),
    );
  const write = <A>(query: Effect.Effect<A, SqlError>, projectId: ProjectId) =>
    query.pipe(
      Effect.mapError(memoryError("Could not save the project memory.")),
      Effect.tap(PubSub.publish(changes, projectId)),
    );

  const list = Effect.fn("ProjectMemoryStore.list")(function* (projectId: ProjectId) {
    return yield* read(
      sql<EntryRow>`SELECT * FROM project_memory_entries WHERE project_id = ${projectId}
        ORDER BY created_at DESC, rowid DESC`,
    );
  });

  const insert = Effect.fn("ProjectMemoryStore.insert")(function* (input: {
    readonly id: string;
    readonly projectId: ProjectId;
    readonly text: string;
    readonly authorThreadId: ThreadId | undefined;
    readonly authorThreadTitle: string | undefined;
  }) {
    const at = yield* now;
    const rows = yield* write(
      sql<EntryRow>`INSERT INTO project_memory_entries ${sql.insert({
        entry_id: input.id,
        project_id: input.projectId,
        text: input.text,
        author_thread_id: input.authorThreadId ?? null,
        author_title: input.authorThreadTitle ?? null,
        created_at: at,
        updated_at: at,
      })} RETURNING *`,
      input.projectId,
    );
    return rows.map(entryOf)[0]!;
  });

  const update = Effect.fn("ProjectMemoryStore.update")(function* (input: {
    readonly projectId: ProjectId;
    readonly entryId: string;
    readonly text: string;
  }) {
    const at = yield* now;
    const rows = yield* write(
      sql<EntryRow>`UPDATE project_memory_entries SET text = ${input.text}, updated_at = ${at}
        WHERE entry_id = ${input.entryId} AND project_id = ${input.projectId} RETURNING *`,
      input.projectId,
    );
    return rows.map(entryOf)[0] ?? null;
  });

  const remove = Effect.fn("ProjectMemoryStore.remove")(function* (input: {
    readonly projectId: ProjectId;
    readonly entryId: string;
  }) {
    const rows = yield* write(
      sql<{ readonly entry_id: string }>`DELETE FROM project_memory_entries
        WHERE entry_id = ${input.entryId} AND project_id = ${input.projectId} RETURNING entry_id`,
      input.projectId,
    );
    return rows.length > 0;
  });

  return { list, insert, update, remove };
};

export type ProjectMemoryStore = ReturnType<typeof makeProjectMemoryStore>;
