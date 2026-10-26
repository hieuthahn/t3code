import * as NodeOS from "node:os";

import { ProjectId, ThreadId, type OrchestrationNestedRepository } from "@t3tools/contracts";
import { fileChangeEntries } from "@t3tools/shared/fileChangeOutputs";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import { discoverNestedRepositories } from "../workspace/nestedRepositoryDiscovery.ts";
import { makeCoalescedCache } from "./CoalescedCache.ts";
import {
  relativeToWorkspace,
  repositoriesInCommand,
  repositoryOfPath,
  toWorkspaceRelativePath,
} from "./RepositoryPaths.ts";

export class NestedRepositoriesError extends Schema.TaggedError<NestedRepositoriesError>()(
  "NestedRepositoriesError",
  {
    operation: Schema.Literals(["query", "decode"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Nested repositories ${this.operation} failed.`;
  }
}

const ProjectRootRequest = Schema.Struct({ projectId: ProjectId });
const ProjectRootRow = Schema.Struct({ workspaceRoot: Schema.String });
const TagRow = Schema.Struct({
  threadId: ThreadId,
  worktreePath: Schema.NullOr(Schema.String),
  type: Schema.String,
  fileName: Schema.NullOr(Schema.String),
  changePathsJson: Schema.NullOr(Schema.String),
  commandInput: Schema.NullOr(Schema.String),
  toolFilePath: Schema.NullOr(Schema.String),
});

const decodeChangePaths = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        oldPath: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
);

/** Normalized names (lowercase, no separators) of tools whose `file_path` input is a file they modify. */
const WRITE_TOOL_NAMES = [
  "edit",
  "multiedit",
  "write",
  "editfile",
  "writefile",
  "createfile",
  "strreplaceeditor",
  "strreplacebasededittool",
];

interface ThreadTouches {
  readonly tags: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly counts: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

const CACHE_TTL_MILLIS = 10_000;
const CACHE_MAX_ENTRIES = 64;

export class NestedRepositories extends Context.Service<
  NestedRepositories,
  {
    /** With a thread id, lists the repositories under that thread's worktree when it has one. */
    readonly list: (
      projectId: ProjectId,
      threadId?: ThreadId,
    ) => Effect.Effect<ReadonlyArray<OrchestrationNestedRepository>, NestedRepositoriesError>;
    readonly threadTags: (
      projectId: ProjectId,
    ) => Effect.Effect<Readonly<Record<string, ReadonlyArray<string>>>, NestedRepositoriesError>;
    /** Per thread, how many tool calls touched each repository. */
    readonly threadTouchCounts: (
      projectId: ProjectId,
    ) => Effect.Effect<
      Readonly<Record<string, Readonly<Record<string, number>>>>,
      NestedRepositoriesError
    >;
  }
>()("t3/orchestration-v2/NestedRepositories") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const home = NodeOS.homedir();
  const scanCache = makeCoalescedCache<
    ReadonlyArray<OrchestrationNestedRepository>,
    NestedRepositoriesError
  >({ ttlMillis: CACHE_TTL_MILLIS, maxEntries: CACHE_MAX_ENTRIES });
  const tagCache = makeCoalescedCache<ThreadTouches, NestedRepositoriesError>({
    ttlMillis: CACHE_TTL_MILLIS,
    maxEntries: CACHE_MAX_ENTRIES,
  });

  const projectRoot = SqlSchema.findOneOption({
    Request: ProjectRootRequest,
    Result: ProjectRootRow,
    execute: ({ projectId }) => sql`
      SELECT workspace_root AS "workspaceRoot"
      FROM projection_projects
      WHERE project_id = ${projectId} AND deleted_at IS NULL
    `,
  });

  const threadWorktree = SqlSchema.findOneOption({
    Request: Schema.Struct({ projectId: ProjectId, threadId: ThreadId }),
    Result: Schema.Struct({ worktreePath: Schema.String }),
    execute: ({ projectId, threadId }) => sql`
      SELECT json_extract(payload_json, '$.worktreePath') AS "worktreePath"
      FROM orchestration_v2_projection_threads
      WHERE thread_id = ${threadId}
        AND project_id = ${projectId}
        AND deleted_at IS NULL
        AND json_extract(payload_json, '$.worktreePath') IS NOT NULL
    `,
  });

  // Only paths leave SQLite, because json_each reduces `changes` to path pairs and diff bodies stay behind.
  const tagRows = SqlSchema.findAll({
    Request: ProjectRootRequest,
    Result: TagRow,
    execute: ({ projectId }) => sql`
      SELECT
        threads.thread_id AS "threadId",
        json_extract(threads.payload_json, '$.worktreePath') AS "worktreePath",
        items.type AS "type",
        json_extract(items.payload_json, '$.fileName') AS "fileName",
        CASE WHEN items.type = 'file_change' THEN (
          SELECT json_group_array(json_object(
            'path', json_extract(change.value, '$.path'),
            'oldPath', json_extract(change.value, '$.oldPath')
          ))
          FROM json_each(items.payload_json, '$.changes') AS change
        ) END AS "changePathsJson",
        CASE WHEN items.type = 'command_execution'
          THEN json_extract(items.payload_json, '$.input') END AS "commandInput",
        CASE WHEN items.type = 'dynamic_tool'
          AND replace(replace(replace(lower(json_extract(items.payload_json, '$.toolName')), '_', ''), '-', ''), ' ', '') IN ${sql.in(WRITE_TOOL_NAMES)}
          THEN json_extract(items.payload_json, '$.input.file_path') END AS "toolFilePath"
      FROM orchestration_v2_projection_turn_items AS items
      INNER JOIN orchestration_v2_projection_threads AS threads
        ON threads.thread_id = items.thread_id
      INNER JOIN projection_projects AS projects
        ON projects.project_id = threads.project_id
      WHERE threads.project_id = ${projectId}
        AND threads.deleted_at IS NULL
        AND projects.deleted_at IS NULL
        AND items.type IN ('file_change', 'command_execution', 'dynamic_tool')
    `,
  });

  const toError = (cause: unknown) =>
    new NestedRepositoriesError({
      operation: Schema.isSchemaError(cause) ? "decode" : "query",
      cause,
    });

  const scan = (workspaceRoot: string) =>
    scanCache(
      workspaceRoot,
      discoverNestedRepositories(workspaceRoot).pipe(Effect.provideContext(services)),
    );

  const rootOf = (projectId: ProjectId) =>
    sql
      .withTransaction(projectRoot({ projectId }))
      .pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(toError),
        Effect.map(Option.map((row) => row.workspaceRoot)),
      );

  const list: NestedRepositories["Service"]["list"] = Effect.fn("NestedRepositories.list")(
    function* (projectId, threadId) {
      const root = yield* rootOf(projectId);
      if (Option.isNone(root)) return [];
      if (threadId === undefined) return yield* scan(root.value);
      const worktree = yield* sql
        .withTransaction(threadWorktree({ projectId, threadId }))
        .pipe(NodeSqliteClient.readOnly, Effect.mapError(toError));
      return yield* scan(Option.isSome(worktree) ? worktree.value.worktreePath : root.value);
    },
  );

  const computeThreadTags = Effect.fn("NestedRepositories.computeThreadTags")(function* (
    projectId: ProjectId,
    workspaceRoot: string,
  ) {
    const repositoryPaths = (yield* scan(workspaceRoot)).map((repository) => repository.path);
    if (repositoryPaths.length === 0) return { tags: {}, counts: {} } satisfies ThreadTouches;
    const rows = yield* sql
      .withTransaction(tagRows({ projectId }))
      .pipe(NodeSqliteClient.readOnly, Effect.mapError(toError));

    const tags = new Map<string, Set<string>>();
    const counts = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const roots = [row.worktreePath, workspaceRoot].filter((value) => value !== null);
      const touched = new Set<string>();
      const addPath = (path: string) => {
        const relative = relativeToWorkspace(path, roots);
        const repository = relative === null ? null : repositoryOfPath(relative, repositoryPaths);
        if (repository !== null) touched.add(repository);
      };
      if (row.type === "file_change") {
        const changes =
          row.changePathsJson === null
            ? undefined
            : Option.getOrUndefined(decodeChangePaths(row.changePathsJson))?.map((change) => ({
                path: change.path,
                oldPath: change.oldPath ?? undefined,
              }));
        for (const change of fileChangeEntries({ fileName: row.fileName ?? "", changes })) {
          for (const path of [change.path, change.oldPath]) {
            if (path !== undefined) addPath(toWorkspaceRelativePath(path, roots, home));
          }
        }
      } else if (row.type === "command_execution" && row.commandInput !== null) {
        for (const repository of repositoriesInCommand(row.commandInput, roots, repositoryPaths)) {
          touched.add(repository);
        }
      } else if (row.type === "dynamic_tool" && row.toolFilePath !== null) {
        addPath(row.toolFilePath);
      }
      if (touched.size === 0) continue;
      const known = tags.get(row.threadId) ?? new Set<string>();
      for (const repository of touched) known.add(repository);
      tags.set(row.threadId, known);
      const threadCounts = counts.get(row.threadId) ?? new Map<string, number>();
      for (const repository of touched) {
        threadCounts.set(repository, (threadCounts.get(repository) ?? 0) + 1);
      }
      counts.set(row.threadId, threadCounts);
    }
    return {
      tags: Object.fromEntries(
        [...tags].map(([threadId, repositories]) => [threadId, [...repositories].toSorted()]),
      ),
      counts: Object.fromEntries(
        [...counts].map(([threadId, perRepository]) => [
          threadId,
          Object.fromEntries(perRepository),
        ]),
      ),
    } satisfies ThreadTouches;
  });

  const threadTags: NestedRepositories["Service"]["threadTags"] = Effect.fn(
    "NestedRepositories.threadTags",
  )(function* (projectId) {
    const root = yield* rootOf(projectId);
    if (Option.isNone(root)) return {};
    return (yield* tagCache(projectId, computeThreadTags(projectId, root.value))).tags;
  });

  const threadTouchCounts: NestedRepositories["Service"]["threadTouchCounts"] = Effect.fn(
    "NestedRepositories.threadTouchCounts",
  )(function* (projectId) {
    const root = yield* rootOf(projectId);
    if (Option.isNone(root)) return {};
    return (yield* tagCache(projectId, computeThreadTags(projectId, root.value))).counts;
  });

  return NestedRepositories.of({ list, threadTags, threadTouchCounts });
});

export const layer = Layer.effect(NestedRepositories, make);
