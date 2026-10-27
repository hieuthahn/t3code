import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE auto_team_verdicts (
      thread_id TEXT NOT NULL,
      run_ordinal INTEGER NOT NULL,
      team_before INTEGER NOT NULL,
      team_after INTEGER NOT NULL,
      judge_team INTEGER,
      team_sure REAL,
      judged_by TEXT NOT NULL,
      team_name TEXT,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, run_ordinal)
    )
  `;
});
