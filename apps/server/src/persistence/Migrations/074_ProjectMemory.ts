import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE project_memory_entries (
      entry_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      text TEXT NOT NULL,
      author_thread_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX project_memory_entries_project ON project_memory_entries (project_id, created_at)
  `;
});
