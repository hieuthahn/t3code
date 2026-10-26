import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../Sqlite.ts";

it.layer(SqlitePersistence.layerMemory)("074_ProjectMemory", (it) => {
  it.effect("keeps one row per entry id", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const row = {
        entry_id: "memory:1",
        project_id: "project:1",
        text: "use pnpm",
        created_at: "2026-10-26T00:00:00.000Z",
        updated_at: "2026-10-26T00:00:00.000Z",
      };
      yield* sql`INSERT INTO project_memory_entries ${sql.insert(row)}`;
      const duplicate = yield* sql`INSERT INTO project_memory_entries ${sql.insert(row)}`.pipe(
        Effect.flip,
      );
      assert.equal(duplicate._tag, "SqlError");
    }),
  );
});
