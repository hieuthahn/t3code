import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

const FIRST_RECONCILED_MIGRATION_ID = 56;

export type LedgerMigrationEntry<E> = readonly [
  id: number,
  name: string,
  migration: Effect.Effect<unknown, E, SqlClient.SqlClient>,
];

/**
 * Move recorded migrations to their manifest ids by name, then run the ones an upstream insertion skipped.
 * Acts only when a recorded name sits at another id, so foreign or newer ledgers reach the startup check untouched.
 */
export const reconcileMigrationLedger = Effect.fn("reconcileMigrationLedger")(function* <E>(
  entries: ReadonlyArray<LedgerMigrationEntry<E>>,
  throughId?: number,
) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const tables = yield* sql`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
      `;
      if (tables.length === 0) return [];
      const manifest = entries.filter(
        ([id]) =>
          id >= FIRST_RECONCILED_MIGRATION_ID && (throughId === undefined || id <= throughId),
      );
      const manifestIds = new Map(manifest.map(([id, name]) => [name, id]));
      const recorded = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations
        WHERE migration_id >= ${FIRST_RECONCILED_MIGRATION_ID}
      `;
      const moves = recorded.flatMap((row) => {
        const targetId = manifestIds.get(row.name);
        return targetId === undefined || targetId === row.migration_id
          ? []
          : [{ fromId: row.migration_id, toId: targetId, name: row.name }];
      });
      if (moves.length === 0) return [];

      const movingIds = new Set(moves.map((move) => move.fromId));
      const blocked = moves.filter((move) =>
        recorded.some((row) => row.migration_id === move.toId && !movingIds.has(row.migration_id)),
      );
      if (blocked.length > 0) {
        return yield* new Migrator.MigrationError({
          kind: "BadState",
          message: `Cannot move recorded migrations to their ids by name; the target ids are taken: ${blocked
            .map((move) => `${move.fromId}_${move.name} -> ${move.toId}`)
            .join(", ")}.`,
        });
      }
      // Negative ids park the moving rows so no target collides with a row that has not moved yet.
      for (const move of moves) {
        yield* sql`UPDATE effect_sql_migrations SET migration_id = ${-move.fromId} WHERE migration_id = ${move.fromId}`;
      }
      for (const move of moves) {
        yield* sql`UPDATE effect_sql_migrations SET migration_id = ${move.toId} WHERE migration_id = ${-move.fromId}`;
      }

      const ledger = yield* sql<{ readonly migration_id: number }>`
        SELECT migration_id FROM effect_sql_migrations
      `;
      const recordedIds = new Set(ledger.map((row) => row.migration_id));
      const latestRecordedId = Math.max(0, ...recordedIds);
      const skipped = manifest
        .filter(([id]) => id < latestRecordedId && !recordedIds.has(id))
        .toSorted(([left], [right]) => left - right);
      const executed: Array<readonly [number, string]> = [];
      for (const [id, name, migration] of skipped) {
        yield* migration.pipe(
          Effect.catch((cause) =>
            Effect.die(
              new Migrator.MigrationError({
                cause,
                kind: "Failed",
                message: `Migration "${id}_${name}" failed`,
              }),
            ),
          ),
        );
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
        executed.push([id, name]);
      }
      return executed;
    }),
  );
});
