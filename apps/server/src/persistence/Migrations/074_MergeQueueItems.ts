import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE merge_queue_items (
      item_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      trunk_ref TEXT NOT NULL,
      owner_thread_id TEXT NOT NULL,
      owner_checkout TEXT NOT NULL,
      child_thread_id TEXT NOT NULL,
      child_title TEXT NOT NULL,
      child_branch TEXT NOT NULL,
      child_worktree TEXT NOT NULL,
      head_sha_at_enqueue TEXT NOT NULL,
      status TEXT NOT NULL,
      approved_by_json TEXT,
      gate_runs_json TEXT NOT NULL DEFAULT '[]',
      trunk_head_before TEXT,
      merged_sha TEXT,
      failure_json TEXT,
      enqueued_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX merge_queue_items_trunk_status
    ON merge_queue_items (project_id, trunk_ref, status, enqueued_at)
  `;
  yield* sql`
    CREATE INDEX merge_queue_items_owner ON merge_queue_items (owner_thread_id, enqueued_at)
  `;
});
