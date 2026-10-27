import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";
import PeerLinks from "./Migrations/070_PeerLinks.ts";
import PeerLinkFence from "./Migrations/071_PeerLinkFence.ts";
import WaitingLinkRequestIndex from "./Migrations/072_WaitingLinkRequestIndex.ts";
import TokenSaverAttempts from "./Migrations/073_TokenSaverAttempts.ts";
import MergeQueueItems from "./Migrations/074_MergeQueueItems.ts";
import TeamRuns from "./Migrations/075_TeamRuns.ts";
import ProjectMemory from "./Migrations/076_ProjectMemory.ts";
import AutoTeamVerdicts from "./Migrations/077_AutoTeamVerdicts.ts";

const oldForkLedger = {
  "68_PeerLinks": PeerLinks,
  "69_PeerLinkFence": PeerLinkFence,
  "70_WaitingLinkRequestIndex": WaitingLinkRequestIndex,
  "71_TokenSaverAttempts": TokenSaverAttempts,
  "72_MergeQueueItems": MergeQueueItems,
  "73_TeamRuns": TeamRuns,
  "74_ProjectMemory": ProjectMemory,
  "75_AutoTeamVerdicts": AutoTeamVerdicts,
};

const seedOldForkLedger = (throughId: number) =>
  Effect.gen(function* () {
    yield* runMigrations({ toMigrationInclusive: 67 });
    yield* Migrator.make({})({
      loader: Migrator.fromRecord(
        Object.fromEntries(
          Object.entries(oldForkLedger).filter(([key]) => Number.parseInt(key, 10) <= throughId),
        ),
      ),
    });
  });

const history = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return rows.map((row) => [row.migration_id, row.name] as const);
});

const schemaNames = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`SELECT name FROM sqlite_master`;
  return new Set(rows.map((row) => row.name));
});

const assertUpstreamInsertionsApplied = Effect.gen(function* () {
  const names = yield* schemaNames;
  assert.isTrue(names.has("orchestration_v2_projection_turn_items_stop_request_idx"));
  assert.isTrue(names.has("orchestration_v2_message_search"));
  assert.isTrue(names.has("orchestration_v2_message_search_insert"));
});

describe("reconcileMigrationLedger", () => {
  it.effect("moves the old fork ledger to the new ids and runs the inserted migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedOldForkLedger(75);
      yield* sql`
        UPDATE effect_sql_migrations SET created_at = '2026-10-23 18:15:53' WHERE migration_id = 71
      `;

      assert.deepStrictEqual(yield* runMigrations(), [
        [68, "ShellStopRequestIndex"],
        [69, "ThreadMessageSearch"],
      ]);
      assert.deepStrictEqual(yield* history, migrationManifest);
      yield* assertUpstreamInsertionsApplied;
      const moved = yield* sql<{ readonly created_at: string }>`
        SELECT created_at FROM effect_sql_migrations WHERE name = 'TokenSaverAttempts'
      `;
      assert.strictEqual(moved[0]?.created_at, "2026-10-23 18:15:53");

      assert.deepStrictEqual(yield* runMigrations(), []);
      assert.deepStrictEqual(yield* history, migrationManifest);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("finishes a partial old fork ledger with the migrator", () =>
    Effect.gen(function* () {
      yield* seedOldForkLedger(74);

      assert.deepStrictEqual(yield* runMigrations(), [
        [68, "ShellStopRequestIndex"],
        [69, "ThreadMessageSearch"],
        [77, "AutoTeamVerdicts"],
      ]);
      assert.deepStrictEqual(yield* history, migrationManifest);
      yield* assertUpstreamInsertionsApplied;
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("leaves a fresh database to the migrator", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* runMigrations(), migrationManifest);
      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("leaves a migration this build does not know at its id", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const unknownId = Math.max(...migrationManifest.map(([id]) => id)) + 1;
      yield* runMigrations();
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, created_at, name)
        VALUES (${unknownId}, '2026-10-27 00:00:00', 'NewerV2Migration')
      `;
      const before = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;

      assert.deepStrictEqual(yield* runMigrations(), []);
      assert.deepStrictEqual(
        yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`,
        before,
      );
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("leaves an unknown name alone while moving the known ones", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedOldForkLedger(75);
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name) VALUES (90, 'SiteLocalMigration')
      `;

      assert.deepStrictEqual(yield* runMigrations(), [
        [68, "ShellStopRequestIndex"],
        [69, "ThreadMessageSearch"],
      ]);
      assert.deepStrictEqual(yield* history, [...migrationManifest, [90, "SiteLocalMigration"]]);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
