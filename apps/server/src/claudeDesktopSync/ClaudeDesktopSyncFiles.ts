import { ClaudeDesktopSyncError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import type * as SqlClient from "effect/sql/SqlClient";
import * as Schema from "effect/Schema";

import type { DesktopOp, UndoStep } from "./ClaudeDesktopSyncItems.ts";

export interface RunLog {
  readonly runId: string;
  readonly at: number;
  readonly undo: ReadonlyArray<UndoStep>;
  readonly undone: boolean;
}

export const LINKS_SNAPSHOT = ".links.json";
const FINAL_STATUSES = new Set(["done", "rejected"]);
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const isSyncError = Schema.is(ClaudeDesktopSyncError);

export const fail = (reason: string) => new ClaudeDesktopSyncError({ reason });
export const toSyncError = (cause: unknown) => (isSyncError(cause) ? cause : fail(String(cause)));

/** Bind the sync state files under `<baseDir>/sync`, shared with claude-accounts. */
export function makeSyncFiles(fileSystem: FileSystem.FileSystem, path: Path.Path, baseDir: string) {
  const syncDir = path.join(baseDir, "sync");
  const files = {
    links: path.join(syncDir, "links.json"),
    pending: path.join(syncDir, "pending-desktop.json"),
    applied: path.join(syncDir, "desktop-applied.json"),
    runs: path.join(syncDir, "runs"),
  };

  const readJson = <A>(file: string, fallback: A) =>
    fileSystem.readFileString(file).pipe(
      Effect.flatMap(decodeJson),
      Effect.map((value) => value as A),
      Effect.orElseSucceed(() => fallback),
    );

  const writeJson = (file: string, value: unknown) =>
    Effect.gen(function* () {
      yield* fileSystem.makeDirectory(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      yield* fileSystem.writeFileString(temp, `${yield* encodeJson(value)}\n`);
      yield* fileSystem.rename(temp, file);
    }).pipe(Effect.mapError((cause) => fail(`could not write ${file}: ${String(cause)}`)));

  const pendingOps = Effect.gen(function* () {
    const pending = yield* readJson<{ ops?: DesktopOp[] }>(files.pending, {});
    const applied = yield* readJson<{ ops?: Record<string, { status?: string }> }>(
      files.applied,
      {},
    );
    return (pending.ops ?? []).filter(
      (op) => !FINAL_STATUSES.has(applied.ops?.[op.opId]?.status ?? ""),
    );
  });

  const lastUndoableRun = Effect.gen(function* () {
    const names = yield* fileSystem.readDirectory(files.runs).pipe(Effect.orElseSucceed(() => []));
    for (const name of names
      .filter((entry) => entry.endsWith(".json") && !entry.endsWith(LINKS_SNAPSHOT))
      .toSorted()
      .toReversed()) {
      const log = yield* readJson<RunLog | null>(path.join(files.runs, name), null);
      if (log !== null && !log.undone && Array.isArray(log.undo) && log.undo.length > 0)
        return Option.some({ name, log });
    }
    return Option.none<{ name: string; log: RunLog }>();
  });

  const updateBusy = Effect.gen(function* () {
    const pidText = yield* fileSystem
      .readFileString(path.join(baseDir, "update.lock", "pid"))
      .pipe(Effect.option);
    if (Option.isNone(pidText)) return false;
    const pid = Number.parseInt(pidText.value.trim(), 10);
    return yield* Effect.try(() => process.kill(pid, 0)).pipe(Effect.orElseSucceed(() => false));
  });

  const backupDatabase = (sql: SqlClient.SqlClient, stamp: string) =>
    Effect.gen(function* () {
      const target = path.join(baseDir, "backups", `before-desktop-sync-${stamp}.sqlite`);
      yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true });
      yield* sql`VACUUM INTO ${target}`;
    }).pipe(Effect.mapError((cause) => fail(`could not back up the database: ${String(cause)}`)));

  return { files, readJson, writeJson, pendingOps, lastUndoableRun, updateBusy, backupDatabase };
}
