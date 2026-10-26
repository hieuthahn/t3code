import * as NodeOS from "node:os";

import {
  IsoDateTime,
  OrchestrationV2FileChangeDetail,
  ORCHESTRATION_PROJECT_LIBRARY_PAGE_LIMIT,
  type OrchestrationListProjectLibraryInput,
  type OrchestrationListProjectLibraryResult,
  type OrchestrationProjectLibraryCursor,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import {
  applyFileChanges,
  fileChangeEntries,
  type FileChangeEntry,
  type FileChangeOutput,
} from "@t3tools/shared/fileChangeOutputs";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

export class ProjectLibraryError extends Schema.TaggedError<ProjectLibraryError>()(
  "ProjectLibraryError",
  {
    operation: Schema.Literals(["query", "decode"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Project library ${this.operation} failed.`;
  }
}

const LibraryRequest = Schema.Struct({ projectId: ProjectId });
const LibraryRow = Schema.Struct({
  threadId: ThreadId,
  threadTitle: Schema.String,
  worktreePath: Schema.NullOr(Schema.String),
  workspaceRoot: Schema.String,
  fileName: Schema.String,
  changesJson: Schema.NullOr(Schema.String),
  changedAt: IsoDateTime,
});

const decodeChanges = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(OrchestrationV2FileChangeDetail)),
);

function normalizeSeparators(path: string): string {
  return path.replaceAll("\\", "/");
}

/** macOS reports /var/... and /private/var/... for the same directory. */
function canonicalPath(path: string): string {
  return normalizeSeparators(path).replace(/^\/private(?=\/)/, "");
}

function stripRoot(path: string, root: string): string | null {
  const canonicalRoot = canonicalPath(root);
  const prefix = canonicalRoot.endsWith("/") ? canonicalRoot : `${canonicalRoot}/`;
  const canonical = canonicalPath(path);
  return canonical.startsWith(prefix) ? canonical.slice(prefix.length) : null;
}

function abbreviateHome(path: string, home: string): string {
  const relative = stripRoot(path, home);
  return relative === null ? path : `~/${relative}`;
}

/**
 * Worktree threads report absolute paths under their own checkout, so strip the
 * thread's worktree first and the project root second. Paths outside both show
 * the home directory as "~".
 */
function toWorkspaceRelativePath(
  path: string,
  roots: ReadonlyArray<string | null>,
  home: string,
): string {
  const relative = roots.reduce<string | null>(
    (found, root) => found ?? (root === null ? null : stripRoot(path, root)),
    null,
  );
  return (relative ?? abbreviateHome(path, home)).replace(/^(\.\/)+/, "");
}

function isAfterCursor(
  entry: { readonly changedAt: string; readonly path: string },
  cursor: OrchestrationProjectLibraryCursor,
): boolean {
  return (
    entry.changedAt < cursor.changedAt ||
    (entry.changedAt === cursor.changedAt && entry.path > cursor.path)
  );
}

function compareEntries(
  left: { readonly changedAt: string; readonly path: string },
  right: { readonly changedAt: string; readonly path: string },
): number {
  if (left.changedAt !== right.changedAt) return left.changedAt < right.changedAt ? 1 : -1;
  if (left.path === right.path) return 0;
  return left.path < right.path ? -1 : 1;
}

export class ProjectLibrary extends Context.Service<
  ProjectLibrary,
  {
    readonly list: (
      input: OrchestrationListProjectLibraryInput,
    ) => Effect.Effect<OrchestrationListProjectLibraryResult, ProjectLibraryError>;
  }
>()("t3/orchestration-v2/ProjectLibrary") {}

interface LastTouch {
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly changedAt: IsoDateTime;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const home = NodeOS.homedir();

  // Columns come from json_extract so the diff bodies in payload_json never
  // leave SQLite. Item ordinals restart per thread, so order by time first.
  const fileChangeRows = SqlSchema.findAll({
    Request: LibraryRequest,
    Result: LibraryRow,
    execute: ({ projectId }) => sql`
      SELECT
        threads.thread_id AS "threadId",
        threads.title AS "threadTitle",
        json_extract(threads.payload_json, '$.worktreePath') AS "worktreePath",
        projects.workspace_root AS "workspaceRoot",
        json_extract(items.payload_json, '$.fileName') AS "fileName",
        json_extract(items.payload_json, '$.changes') AS "changesJson",
        items.updated_at AS "changedAt"
      FROM orchestration_v2_projection_turn_items AS items
      INNER JOIN orchestration_v2_projection_threads AS threads
        ON threads.thread_id = items.thread_id
      INNER JOIN projection_projects AS projects
        ON projects.project_id = threads.project_id
      WHERE threads.project_id = ${projectId}
        AND threads.deleted_at IS NULL
        AND projects.deleted_at IS NULL
        AND items.type = 'file_change'
        AND items.status = 'completed'
      ORDER BY items.updated_at ASC, threads.thread_id ASC, items.ordinal ASC, items.turn_item_id ASC
    `,
  });

  const list: ProjectLibrary["Service"]["list"] = Effect.fn("ProjectLibrary.list")(
    function* (input) {
      const rows = yield* sql.withTransaction(fileChangeRows({ projectId: input.projectId })).pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(
          (cause) =>
            new ProjectLibraryError({
              operation: Schema.isSchemaError(cause) ? "decode" : "query",
              cause,
            }),
        ),
      );

      const byPath = new Map<string, FileChangeOutput<LastTouch>>();
      for (const row of rows) {
        const roots = [row.worktreePath, row.workspaceRoot];
        const changes: ReadonlyArray<FileChangeEntry> = fileChangeEntries({
          fileName: row.fileName,
          changes:
            row.changesJson === null
              ? undefined
              : Option.getOrUndefined(decodeChanges(row.changesJson)),
        }).map((change) => ({
          operation: change.operation,
          path: toWorkspaceRelativePath(change.path, roots, home),
          oldPath:
            change.oldPath === undefined
              ? undefined
              : toWorkspaceRelativePath(change.oldPath, roots, home),
        }));
        applyFileChanges(byPath, changes, {
          threadId: row.threadId,
          threadTitle: row.threadTitle,
          changedAt: row.changedAt,
        });
      }

      const ordered = [...byPath]
        .map(([path, { status, meta }]) => ({ path, status, ...meta }))
        .toSorted(compareEntries);
      const limit = input.limit ?? ORCHESTRATION_PROJECT_LIBRARY_PAGE_LIMIT;
      const cursor = input.cursor;
      const start =
        cursor !== undefined
          ? ordered.findIndex((entry) => isAfterCursor(entry, cursor))
          : (input.offset ?? 0);
      const remaining = start < 0 ? [] : ordered.slice(start);
      const entries = remaining.slice(0, limit);
      const hasMore = remaining.length > entries.length;
      const last = entries.at(-1);
      return {
        entries,
        total: ordered.length,
        nextOffset: cursor === undefined && hasMore ? start + limit : null,
        nextCursor:
          hasMore && last !== undefined ? { changedAt: last.changedAt, path: last.path } : null,
      };
    },
  );

  return ProjectLibrary.of({ list });
});

export const layer = Layer.effect(ProjectLibrary, make);
