import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE team_runs (
      run_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      status TEXT NOT NULL,
      rounds INTEGER NOT NULL DEFAULT 0,
      stalls INTEGER NOT NULL DEFAULT 0,
      last_stall_run_id TEXT,
      caller_scope_json TEXT NOT NULL,
      report TEXT,
      summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX team_runs_thread ON team_runs (thread_id, created_at)`;
  yield* sql`CREATE INDEX team_runs_status ON team_runs (status)`;
  yield* sql`
    CREATE TABLE team_assignments (
      run_id TEXT NOT NULL,
      assignment_key TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      title TEXT NOT NULL,
      task TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      model TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '[]',
      depends_on_json TEXT NOT NULL DEFAULT '[]',
      read_only INTEGER NOT NULL DEFAULT 0,
      files_json TEXT NOT NULL DEFAULT '[]',
      isolation TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      task_id TEXT,
      child_thread_id TEXT,
      failure TEXT,
      result TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, assignment_key)
    )
  `;
});
