import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { DesktopSession } from "./ClaudeDesktopSyncPlan.ts";

const PROFILE_PREFIX = "Claude";
const NOT_PROFILES = new Set(["Claude-sync-backups", "Claude-shared-sessions", "Claude-3p"]);
const FORK_OVERLAP = 0.95;
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeJsonOption = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

export interface DesktopStoreRoots {
  /** The folder holding one `Claude*` folder per Claude Desktop profile. */
  readonly applicationSupport: string;
  /** Claude Code's transcript folder, `~/.claude/projects`. */
  readonly projects: string;
}

interface Copy {
  readonly session: DesktopSession;
  readonly touchedMs: number;
}

const readJson = (fileSystem: FileSystem.FileSystem, file: string) =>
  fileSystem.readFileString(file).pipe(
    Effect.flatMap(decodeJson),
    Effect.orElseSucceed((): unknown => null),
  );

const stringArray = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

/** Read every Claude Desktop profile's Code-tab sessions and merge them the way claude-accounts sync does. */
export const readDesktopSessions = Effect.fn("readDesktopSessions")(function* (
  roots: DesktopStoreRoots,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const transcripts = yield* transcriptIds(roots.projects);
  const profiles = (yield* fileSystem
    .readDirectory(roots.applicationSupport)
    .pipe(Effect.orElseSucceed(() => []))).filter(
    (name) =>
      name.startsWith(PROFILE_PREFIX) &&
      !NOT_PROFILES.has(name) &&
      !name.startsWith("Claude-pre-share"),
  );
  const copies = new Map<string, Copy>();
  const tombstones = new Map<string, number>();
  const orgFolders: Array<{ readonly orgId: string; readonly folder: string }> = [];
  for (const profile of profiles) {
    const sessionsRoot = path.join(roots.applicationSupport, profile, "claude-code-sessions");
    for (const account of yield* fileSystem
      .readDirectory(sessionsRoot)
      .pipe(Effect.orElseSucceed(() => []))) {
      for (const orgId of yield* fileSystem
        .readDirectory(path.join(sessionsRoot, account))
        .pipe(Effect.orElseSucceed(() => []))) {
        orgFolders.push({ orgId, folder: path.join(sessionsRoot, account, orgId) });
      }
    }
  }
  for (const { orgId, folder } of orgFolders) {
    for (const name of yield* fileSystem
      .readDirectory(folder)
      .pipe(Effect.orElseSucceed(() => []))) {
      const file = path.join(folder, name);
      if (name.startsWith("deleted_")) {
        const stamp = Number.parseInt(
          (yield* fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => "0"))).trim(),
          10,
        );
        const localId = `local_${name.slice("deleted_".length)}`;
        tombstones.set(
          localId,
          Math.max(tombstones.get(localId) ?? 0, Number.isFinite(stamp) ? stamp : 0),
        );
        continue;
      }
      if (!name.startsWith("local_") || !name.endsWith(".json")) continue;
      const data = yield* readJson(fileSystem, file);
      if (typeof data !== "object" || data === null) continue;
      const record = data as Record<string, unknown>;
      if (typeof record.cliSessionId !== "string" || typeof record.cwd !== "string") continue;
      const info = yield* fileSystem.stat(file).pipe(Effect.option);
      const touchedMs = Option.isSome(info)
        ? (Option.getOrUndefined(info.value.mtime)?.getTime() ?? 0)
        : 0;
      const localId = name.slice(0, -".json".length);
      const lastActivityAt =
        typeof record.lastActivityAt === "number" ? record.lastActivityAt : touchedMs;
      const session: DesktopSession = {
        localId,
        orgId,
        cliSessionId: record.cliSessionId,
        priorCliSessionIds: stringArray(record.priorCliSessionIds),
        cwd: record.cwd,
        title: typeof record.title === "string" ? record.title : "",
        isArchived: record.isArchived === true,
        deleted: false,
        scratch: record.cwd.includes("/scratch-workspaces/"),
        hasTranscript: transcripts.has(record.cliSessionId),
        lastActivityAt,
        createdAt: typeof record.createdAt === "number" ? record.createdAt : lastActivityAt,
      };
      const current = copies.get(localId);
      if (
        current === undefined ||
        session.lastActivityAt > current.session.lastActivityAt ||
        (session.lastActivityAt === current.session.lastActivityAt && touchedMs > current.touchedMs)
      ) {
        copies.set(localId, { session, touchedMs });
      }
    }
  }
  return [...copies.values()].map(({ session }) =>
    (tombstones.get(session.localId) ?? -1) >= session.lastActivityAt
      ? { ...session, deleted: true }
      : session,
  );
});

/** Return the ids of every transcript under the projects folder. */
export const transcriptIds = Effect.fn("transcriptIds")(function* (projects: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const ids = new Set<string>();
  for (const folder of yield* fileSystem
    .readDirectory(projects)
    .pipe(Effect.orElseSucceed(() => []))) {
    for (const name of yield* fileSystem
      .readDirectory(path.join(projects, folder))
      .pipe(Effect.orElseSucceed(() => []))) {
      if (name.endsWith(".jsonl")) ids.add(name.slice(0, -".jsonl".length));
    }
  }
  return ids;
});

/** Map each transcript id to the project folder and file that hold it, in one scan. */
export const transcriptIndex = Effect.fn("transcriptIndex")(function* (projects: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const index = new Map<string, { readonly folder: string; readonly file: string }>();
  for (const folder of yield* fileSystem
    .readDirectory(projects)
    .pipe(Effect.orElseSucceed(() => []))) {
    for (const name of yield* fileSystem
      .readDirectory(path.join(projects, folder))
      .pipe(Effect.orElseSucceed(() => []))) {
      if (name.endsWith(".jsonl")) {
        index.set(name.slice(0, -".jsonl".length), {
          folder,
          file: path.join(projects, folder, name),
        });
      }
    }
  }
  return index;
});

/** Return the user and assistant record uuids of one transcript file, or null when it cannot be read. */
export const transcriptFileUuids = Effect.fn("transcriptFileUuids")(function* (file: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const uuids = new Set<string>();
  const read = yield* fileSystem.stream(file).pipe(
    Stream.decodeText,
    Stream.splitLines,
    Stream.runForEach((line) =>
      Effect.sync(() => {
        if (!line.includes('"uuid"')) return;
        const record = Option.getOrNull(decodeJsonOption(line)) as {
          type?: unknown;
          uuid?: unknown;
        } | null;
        if (
          (record?.type === "user" || record?.type === "assistant") &&
          typeof record.uuid === "string"
        ) {
          uuids.add(record.uuid);
        }
      }),
    ),
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
  return read ? uuids : null;
});

/**
 * Find the T3 session each child forked from. A fork keeps its parent's cwd, so only transcripts
 * in the child's project folder are compared, and each transcript is read at most once.
 */
export const findForkParents = Effect.fn("findForkParents")(function* (
  projects: string,
  childIds: ReadonlyArray<string>,
  parentIds: ReadonlySet<string>,
) {
  const index = yield* transcriptIndex(projects);
  const cache = new Map<string, ReadonlySet<string> | null>();
  const uuidsOf = (id: string) =>
    Effect.gen(function* () {
      const cached = cache.get(id);
      if (cached !== undefined) return cached;
      const entry = index.get(id);
      const uuids = entry === undefined ? null : yield* transcriptFileUuids(entry.file);
      cache.set(id, uuids);
      return uuids;
    });
  const byFolder = new Map<string, string[]>();
  for (const id of parentIds) {
    const entry = index.get(id);
    if (entry !== undefined)
      byFolder.set(entry.folder, [...(byFolder.get(entry.folder) ?? []), id]);
  }
  const parents = new Map<string, string | null>();
  for (const childId of childIds) {
    const folder = index.get(childId)?.folder;
    const candidates =
      folder === undefined ? [] : (byFolder.get(folder) ?? []).filter((id) => id !== childId);
    let parent: string | null = null;
    const child = candidates.length === 0 ? null : yield* uuidsOf(childId);
    if (child !== null) {
      for (const candidate of candidates) {
        const other = yield* uuidsOf(candidate);
        if (other !== null && isForkOf(child, other)) {
          parent = candidate;
          break;
        }
      }
    }
    parents.set(childId, parent);
  }
  return parents;
});

/** Say whether `child` is a fork of `parent`: almost every message of the child already sits in the parent. */
export function isForkOf(child: ReadonlySet<string>, parent: ReadonlySet<string>): boolean {
  if (child.size === 0) return false;
  let shared = 0;
  for (const uuid of child) if (parent.has(uuid)) shared += 1;
  return shared / child.size >= FORK_OVERLAP;
}
