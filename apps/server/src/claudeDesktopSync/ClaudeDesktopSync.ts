import * as OS from "node:os";

import {
  ClaudeDesktopSyncError,
  CommandId,
  ProjectId,
  ThreadId,
  type ClaudeDesktopSyncApplyInput,
  type ClaudeDesktopSyncApplyResult,
  type ClaudeDesktopSyncPreview,
  type ClaudeDesktopSyncRequest,
  type ClaudeDesktopSyncResponse,
  type ClaudeDesktopSyncUndoResult,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";

import { ServerConfig } from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as AgentSessionImporter from "../project/AgentSessionImporter.ts";
import * as ProjectService from "../project/ProjectService.ts";
import {
  findForkParents,
  readDesktopSessions,
  type DesktopStoreRoots,
} from "./ClaudeDesktopStore.ts";
import {
  planSync,
  sessionKeys,
  type DesktopSession,
  type SyncItem,
  type SyncLink,
  type T3Thread,
} from "./ClaudeDesktopSyncPlan.ts";
import {
  fail,
  LINKS_SNAPSHOT,
  makeSyncFiles,
  toSyncError,
  type RunLog,
} from "./ClaudeDesktopSyncFiles.ts";
import {
  describe,
  desktopOrgId,
  nextLinks,
  resolveSelection,
  type DesktopIntent,
  type DesktopOp,
  type UndoStep,
} from "./ClaudeDesktopSyncItems.ts";
import { readT3Threads } from "./ClaudeDesktopT3Threads.ts";

interface Gathered {
  readonly desktop: ReadonlyArray<DesktopSession>;
  readonly threads: ReadonlyArray<T3Thread>;
  readonly links: ReadonlyArray<SyncLink>;
}

export interface ClaudeDesktopSyncOptions {
  readonly roots?: DesktopStoreRoots;
  readonly now?: () => number;
}

const make = (options: ClaudeDesktopSyncOptions) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sql = yield* SqlClient.SqlClient;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projects = yield* ProjectService.ProjectService;
    const importer = yield* AgentSessionImporter.AgentSessionImporter;
    const lock = yield* Semaphore.make(1);
    const crypto = yield* Crypto.Crypto;
    const newId = crypto.randomUUIDv4().pipe(Effect.orDie);
    const now = options.now === undefined ? Clock.currentTimeMillis : Effect.sync(options.now);
    const roots = options.roots ?? {
      applicationSupport: path.join(OS.homedir(), "Library", "Application Support"),
      projects: path.join(OS.homedir(), ".claude", "projects"),
    };
    const { files, readJson, writeJson, pendingOps, lastUndoableRun, updateBusy, backupDatabase } =
      makeSyncFiles(fileSystem, path, config.baseDir);

    const gather = Effect.gen(function* () {
      const desktop = yield* readDesktopSessions(roots);
      const threads = [...(yield* readT3Threads(orchestrator, projects, roots.projects))];
      const links = (yield* readJson<{ links?: SyncLink[] }>(files.links, {})).links ?? [];
      const known = new Set(threads.map((thread) => thread.threadId));
      for (const link of links) {
        if (known.has(link.t3ThreadId)) continue;
        known.add(link.t3ThreadId);
        threads.push({
          threadId: link.t3ThreadId,
          projectId: "",
          workspaceRoot: "",
          title: link.t3.title,
          archived: link.t3.archived,
          deleted: true,
          running: false,
          claudeSessionIds: link.sessionIds,
          hasTranscript: false,
          createdAt: 0,
          updatedAt: 0,
        });
      }
      return { desktop, threads, links } satisfies Gathered;
    });

    const forkParents = (gathered: Gathered) => {
      const known = new Set(gathered.threads.flatMap((thread) => thread.claudeSessionIds));
      const children = gathered.desktop
        .filter(
          (session) =>
            !session.deleted &&
            !session.isArchived &&
            !sessionKeys(session).some((key) => known.has(key)),
        )
        .map((session) => session.cliSessionId);
      return findForkParents(roots.projects, children, known);
    };

    const plan = Effect.gen(function* () {
      const gathered = yield* gather;
      const parents = yield* forkParents(gathered);
      return {
        gathered,
        result: planSync({
          ...gathered,
          now: yield* now,
          forkParentOf: (id) => parents.get(id) ?? null,
        }),
      };
    });

    const preview = Effect.gen(function* () {
      const { gathered, result } = yield* plan;
      return {
        items: result.items.map(describe),
        desktopSessionCount: gathered.desktop.length,
        t3ThreadCount: gathered.threads.filter((thread) => !thread.deleted).length,
        pendingDesktopOpCount: (yield* pendingOps).length,
        canUndo: Option.isSome(yield* lastUndoableRun),
      } satisfies ClaudeDesktopSyncPreview;
    }).pipe(Effect.mapError(toSyncError));

    const commandId = newId.pipe(Effect.map(CommandId.make));
    const dispatch = (command: OrchestrationV2ServerCommand) =>
      orchestrator.dispatch(command).pipe(
        Effect.asVoid,
        Effect.mapError((cause) => fail(String(cause))),
      );
    const rename = (threadId: string, title: string) =>
      Effect.gen(function* () {
        yield* dispatch({
          type: "thread.metadata.update",
          commandId: yield* commandId,
          threadId: ThreadId.make(threadId),
          title,
        });
      });
    const setArchived = (threadId: string, archived: boolean) =>
      Effect.gen(function* () {
        yield* dispatch({
          type: archived ? "thread.archive" : "thread.unarchive",
          commandId: yield* commandId,
          threadId: ThreadId.make(threadId),
        });
      });

    const apply = (input: ClaudeDesktopSyncApplyInput) =>
      lock
        .withPermits(1)(
          Effect.gen(function* () {
            if (yield* updateBusy)
              return yield* fail("t3-update is installing an update; try again when it finishes");
            const { gathered, result } = yield* plan;
            const chosen = resolveSelection(result.items, input);
            const stamp = String(yield* now);
            const runId = `${stamp}-${(yield* newId).slice(0, 8)}`;
            if (chosen.some((item) => item.kind === "importToT3" || item.kind.endsWith("T3")))
              yield* backupDatabase(sql, stamp);
            yield* fileSystem
              .makeDirectory(files.runs, { recursive: true })
              .pipe(Effect.orElseSucceed(() => undefined));
            yield* fileSystem
              .copyFile(files.links, path.join(files.runs, `${runId}${LINKS_SNAPSHOT}`))
              .pipe(Effect.ignore);

            const orgId = desktopOrgId(gathered.desktop);
            const undo: UndoStep[] = [];
            const queued: DesktopOp[] = [];
            const failed: Array<{ id: string; error: string }> = [];
            const desktopIntent = new Map<string, DesktopIntent>();
            const created: Array<{ thread: T3Thread; op: DesktopOp & { kind: "create" } }> = [];
            const imports = new Map<string, DesktopSession[]>();
            const importFailed = new Set<string>();
            let applied = 0;
            const queue = (op: DesktopOp, inverse: DesktopOp | null, intent: DesktopIntent) => {
              queued.push(op);
              if (inverse !== null) undo.push({ side: "desktop", id: op.opId, op: inverse });
              desktopIntent.set(op.sessionId, { ...desktopIntent.get(op.sessionId), ...intent });
            };

            for (const item of chosen) {
              const outcome = yield* Effect.gen(function* () {
                switch (item.kind) {
                  case "importToT3": {
                    imports.set(item.desktop.cwd, [
                      ...(imports.get(item.desktop.cwd) ?? []),
                      item.desktop,
                    ]);
                    return;
                  }
                  case "renameT3":
                    yield* rename(item.pair.thread.threadId, item.title);
                    undo.push({
                      side: "t3",
                      id: item.id,
                      command: "rename",
                      threadId: item.pair.thread.threadId,
                      title: item.pair.thread.title,
                    });
                    return;
                  case "archiveT3":
                  case "suggestArchiveT3": {
                    const archived = item.kind === "archiveT3" ? item.archived : true;
                    yield* setArchived(item.pair.thread.threadId, archived);
                    undo.push({
                      side: "t3",
                      id: item.id,
                      command: archived ? "unarchive" : "archive",
                      threadId: item.pair.thread.threadId,
                    });
                    return;
                  }
                  case "renameDesktop": {
                    const { desktop } = item.pair;
                    queue(
                      {
                        opId: yield* newId,
                        kind: "title",
                        orgId: desktop.orgId,
                        sessionId: desktop.localId,
                        title: item.title,
                      },
                      {
                        opId: yield* newId,
                        kind: "title",
                        orgId: desktop.orgId,
                        sessionId: desktop.localId,
                        title: desktop.title,
                      },
                      { title: item.title },
                    );
                    return;
                  }
                  case "archiveDesktop":
                  case "suggestArchiveDesktop": {
                    const { desktop } = item.pair;
                    const archived = item.kind === "archiveDesktop" ? item.archived : true;
                    queue(
                      {
                        opId: yield* newId,
                        kind: "archive",
                        orgId: desktop.orgId,
                        sessionId: desktop.localId,
                        isArchived: archived,
                      },
                      {
                        opId: yield* newId,
                        kind: "archive",
                        orgId: desktop.orgId,
                        sessionId: desktop.localId,
                        isArchived: !archived,
                      },
                      { isArchived: archived },
                    );
                    return;
                  }
                  case "createInDesktop": {
                    if (orgId === null)
                      return yield* fail("no Claude Desktop session folder found");
                    const sessionId = `local_${yield* newId}`;
                    const op = {
                      opId: yield* newId,
                      kind: "create" as const,
                      orgId,
                      sessionId,
                      cliSessionId: item.sessionId,
                      priorCliSessionIds: item.thread.claudeSessionIds.filter(
                        (id) => id !== item.sessionId,
                      ),
                      cwd: item.thread.workspaceRoot,
                      title: item.thread.title,
                      isArchived: false,
                      createdAt: item.thread.createdAt,
                      lastActivityAt: item.thread.updatedAt,
                      t3ThreadId: item.thread.threadId,
                    };
                    queue(
                      op,
                      { opId: yield* newId, kind: "archive", orgId, sessionId, isArchived: true },
                      { title: op.title, isArchived: false },
                    );
                    created.push({ thread: item.thread, op });
                    return;
                  }
                  default:
                    return;
                }
              }).pipe(
                Effect.as(true),
                Effect.catch((cause) =>
                  Effect.sync(() => (failed.push({ id: item.id, error: cause.message }), false)),
                ),
              );
              if (outcome && item.kind !== "importToT3") applied += 1;
            }

            for (const [cwd, sessions] of imports) {
              const imported = yield* Effect.gen(function* () {
                const { project } = yield* projects.bootstrap({
                  commandId: yield* commandId,
                  projectId: ProjectId.make(yield* newId),
                  title: path.basename(cwd) || cwd,
                  workspaceRoot: cwd,
                });
                const ids = new Set(sessions.flatMap(sessionKeys));
                return yield* importer.importRecentAgentThreads(
                  { projectId: project.id },
                  { onlyProviderSessionIds: ids },
                );
              }).pipe(
                Effect.as(null),
                Effect.catch((cause) => Effect.succeed(cause.message)),
              );
              if (imported !== null) {
                for (const session of sessions) {
                  importFailed.add(session.localId);
                  failed.push({ id: `import:${session.localId}`, error: imported });
                }
              }
            }

            if (queued.length > 0) {
              const pending = yield* pendingOps;
              yield* writeJson(files.pending, { v: 1, ops: [...pending, ...queued] });
            }

            const after = yield* plan;
            const importedPairs = after.result.pairs.filter(
              (pair) =>
                imports.has(pair.desktop.cwd) &&
                (imports.get(pair.desktop.cwd) ?? []).some(
                  (session) => session.localId === pair.desktop.localId,
                ),
            );
            for (const session of [...imports.values()].flat()) {
              if (importFailed.has(session.localId)) continue;
              const pair = importedPairs.find(
                (candidate) => candidate.desktop.localId === session.localId,
              );
              if (pair === undefined) {
                failed.push({
                  id: `import:${session.localId}`,
                  error: "not imported (older than 30 days, or the transcript could not be read)",
                });
                continue;
              }
              applied += 1;
              undo.push({
                side: "t3",
                id: `import:${session.localId}`,
                command: "delete",
                threadId: pair.thread.threadId,
              });
            }

            const syncedAt = yield* now;
            const links = nextLinks({
              links: after.gathered.links,
              items: after.result.items,
              pairs: after.result.pairs,
              desktopIntent,
              created,
              syncedAt,
            });
            yield* writeJson(files.links, { v: 1, links });
            yield* writeJson(path.join(files.runs, `${runId}.json`), {
              runId,
              at: syncedAt,
              undo,
              undone: false,
            } satisfies RunLog);
            return {
              runId,
              applied,
              queuedForDesktop: queued.length,
              failed,
            } satisfies ClaudeDesktopSyncApplyResult;
          }),
        )
        .pipe(Effect.mapError(toSyncError));

    const undoLast = lock
      .withPermits(1)(
        Effect.gen(function* () {
          if (yield* updateBusy)
            return yield* fail("t3-update is installing an update; try again when it finishes");
          const last = yield* lastUndoableRun;
          if (Option.isNone(last))
            return { runId: null, undone: 0, failed: [] } satisfies ClaudeDesktopSyncUndoResult;
          const { name, log } = last.value;
          const failed: Array<{ id: string; error: string }> = [];
          const desktopOps: DesktopOp[] = [];
          let undone = 0;
          for (const step of log.undo.toReversed()) {
            if (step.side === "desktop") {
              desktopOps.push({ ...step.op, opId: yield* newId });
              undone += 1;
              continue;
            }
            const effect =
              step.command === "rename"
                ? rename(step.threadId, step.title)
                : step.command === "delete"
                  ? dispatch({
                      type: "thread.delete",
                      commandId: yield* commandId,
                      threadId: ThreadId.make(step.threadId),
                    })
                  : setArchived(step.threadId, step.command === "archive");
            const ok = yield* effect.pipe(
              Effect.as(true),
              Effect.catch((cause) =>
                Effect.sync(() => (failed.push({ id: step.id, error: cause.message }), false)),
              ),
            );
            if (ok) undone += 1;
          }
          if (desktopOps.length > 0) {
            yield* writeJson(files.pending, { v: 1, ops: [...(yield* pendingOps), ...desktopOps] });
          }
          yield* fileSystem
            .copyFile(path.join(files.runs, `${log.runId}${LINKS_SNAPSHOT}`), files.links)
            .pipe(Effect.ignore);
          yield* writeJson(path.join(files.runs, name), { ...log, undone: true });
          return { runId: log.runId, undone, failed } satisfies ClaudeDesktopSyncUndoResult;
        }),
      )
      .pipe(Effect.mapError(toSyncError));

    const withFiles = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
      effect.pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );

    const run = (
      request: ClaudeDesktopSyncRequest,
    ): Effect.Effect<ClaudeDesktopSyncResponse, ClaudeDesktopSyncError> => {
      switch (request.action) {
        case "preview":
          return withFiles(preview).pipe(Effect.map((result) => ({ preview: result })));
        case "apply":
          return withFiles(apply(request.apply ?? { selectedIds: [], conflictChoices: [] })).pipe(
            Effect.map((result) => ({ apply: result })),
          );
        case "undoLast":
          return withFiles(undoLast).pipe(Effect.map((result) => ({ undoLast: result })));
      }
    };

    return { run } satisfies ClaudeDesktopSyncShape;
  });

export interface ClaudeDesktopSyncShape {
  readonly run: (
    request: ClaudeDesktopSyncRequest,
  ) => Effect.Effect<ClaudeDesktopSyncResponse, ClaudeDesktopSyncError>;
}

export class ClaudeDesktopSync extends Context.Service<ClaudeDesktopSync, ClaudeDesktopSyncShape>()(
  "t3/claudeDesktopSync/ClaudeDesktopSync",
) {}

export const layer = (options: ClaudeDesktopSyncOptions = {}) =>
  Layer.effect(ClaudeDesktopSync, make(options));
