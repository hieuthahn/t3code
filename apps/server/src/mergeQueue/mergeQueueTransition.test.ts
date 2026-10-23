import { assert, it } from "@effect/vitest";
import { MergeQueueItemId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import { makeItemTransition } from "./mergeQueueTransition.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));
const itemId = MergeQueueItemId.make("merge-queue:api");
const at = "2026-10-24T00:00:00.000Z";

layer("makeItemTransition", (it) => {
  it.effect("moves an item only out of the statuses the caller expects", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 72 });
      yield* sql`INSERT INTO merge_queue_items ${sql.insert({
        item_id: itemId,
        project_id: "project",
        trunk_ref: "main",
        owner_thread_id: "thread:owner",
        owner_checkout: "/repo",
        child_thread_id: "thread:api",
        child_title: "API",
        child_branch: "child/api",
        child_worktree: "/repo-api",
        head_sha_at_enqueue: "abc1234",
        status: "updating",
        gate_runs_json: "[]",
        enqueued_at: at,
        updated_at: at,
      })}`;
      const transition = makeItemTransition(sql);

      assert.isFalse(yield* transition(itemId, ["queued"], { status: "cancelled" }, at));
      const untouched = yield* sql<{ status: string }>`
        SELECT status FROM merge_queue_items WHERE item_id = ${itemId}
      `;
      assert.equal(untouched[0]?.status, "updating");

      assert.isTrue(yield* transition(itemId, ["updating", "gating"], { status: "failed" }, at));
      const moved = yield* sql<{ status: string }>`
        SELECT status FROM merge_queue_items WHERE item_id = ${itemId}
      `;
      assert.equal(moved[0]?.status, "failed");
    }),
  );
});
