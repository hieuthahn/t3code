import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("072_MergeQueueItems", (it) => {
  it.effect("adds an empty merge queue table indexed by trunk and status", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 72 });

      const rows = yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM merge_queue_items`;
      assert.equal(rows[0]?.count, 0);
      const indexes = yield* sql<{ name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'merge_queue_items'
      `;
      assert.isTrue(indexes.some((index) => index.name === "merge_queue_items_trunk_status"));
    }),
  );
});
