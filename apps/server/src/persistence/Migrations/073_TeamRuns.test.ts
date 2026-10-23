import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("073_TeamRuns", (it) => {
  it.effect("adds empty team run and assignment tables, one key per run", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 73 });

      const runs = yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM team_runs`;
      assert.equal(runs[0]?.count, 0);
      const row = {
        run_id: "team-run:1",
        assignment_key: "api",
        ordinal: 1,
        title: "Build the API",
        task: "Build it.",
        instance_id: "codex",
        model: "gpt-5-codex",
        isolation: "worktree",
        status: "waiting",
        created_at: "2026-10-24T00:00:00.000Z",
        updated_at: "2026-10-24T00:00:00.000Z",
      };
      yield* sql`INSERT INTO team_assignments ${sql.insert(row)}`;
      const duplicate = yield* sql`INSERT INTO team_assignments ${sql.insert(row)}`.pipe(
        Effect.flip,
      );
      assert.equal(duplicate._tag, "SqlError");
      const assignments = yield* sql<{ count: number }>`
        SELECT COUNT(*) AS count FROM team_assignments
      `;
      assert.equal(assignments[0]?.count, 1);
    }),
  );
});
