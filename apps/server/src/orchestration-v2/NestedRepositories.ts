import * as NodeOS from "node:os";

import {
  OrchestrationV2FileChangeDetail,
  ProjectId,
  ThreadId,
  type OrchestrationNestedRepository,
} from "@t3tools/contracts";
import { fileChangeEntries } from "@t3tools/shared/fileChangeOutputs";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

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

const MAX_SCAN_DEPTH = 2;
const CACHE_TTL_MILLIS = 10_000;

const isScannableName = (name: string) => !name.startsWith(".") && name !== "node_modules";

/** Reads the repositories under a workspace root; unreadable entries are skipped. */
const discover = Effect.fn("NestedRepositories.discover")(function* (workspaceRoot: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const readText = (file: string) => fs.readFileString(file).pipe(Effect.orElseSucceed(() => null));
  const isDirectory = (target: string) =>
    fs.stat(target).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );

  /** Locates the git directory behind a `.git` directory or a `gitdir:` pointer file. */
  const resolveGitDirectory = Effect.fn("NestedRepositories.resolveGitDirectory")(function* (
    repositoryPath: string,
  ) {
    const dotGit = path.join(repositoryPath, ".git");
    if (yield* isDirectory(dotGit)) return dotGit;
    const pointer = (yield* readText(dotGit))?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
    return pointer === undefined ? null : path.resolve(repositoryPath, pointer);
  });

  /** A worktree's config lives in the common directory named by its `commondir` file. */
  const readOriginUrl = Effect.fn("NestedRepositories.readOriginUrl")(function* (
    gitDirectory: string,
  ) {
    const commonPointer = (yield* readText(path.join(gitDirectory, "commondir")))?.trim();
    const commonDirectory =
      commonPointer === undefined ? gitDirectory : path.resolve(gitDirectory, commonPointer);
    const config = yield* readText(path.join(commonDirectory, "config"));
    if (config === null) return null;
    let inOrigin = false;
    for (const line of config.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("[")) inOrigin = /^\[remote\s+"origin"\]$/.test(trimmed);
      else if (inOrigin) {
        const url = trimmed.match(/^url\s*=\s*(.+)$/)?.[1];
        if (url !== undefined) return url.trim();
      }
    }
    return null;
  });

  const describeRepository = Effect.fn("NestedRepositories.describeRepository")(function* (
    relativePath: string,
  ) {
    const gitDirectory = yield* resolveGitDirectory(path.join(workspaceRoot, relativePath));
    const head = gitDirectory === null ? null : yield* readText(path.join(gitDirectory, "HEAD"));
    return {
      path: relativePath,
      name: relativePath.split("/").at(-1) ?? relativePath,
      branch: head?.match(/^ref:\s*refs\/heads\/(.+?)\s*$/m)?.[1] ?? null,
      originUrl: gitDirectory === null ? null : yield* readOriginUrl(gitDirectory),
    } satisfies OrchestrationNestedRepository;
  });

  const found: string[] = [];
  const walk = Effect.fn("NestedRepositories.walk")(function* (
    relativeDirectory: string,
    depth: number,
  ): Effect.fn.Return<void> {
    const names = yield* fs
      .readDirectory(path.join(workspaceRoot, relativeDirectory))
      .pipe(Effect.orElseSucceed(() => []));
    for (const name of names.toSorted()) {
      const relativePath = relativeDirectory === "" ? name : `${relativeDirectory}/${name}`;
      if (!isScannableName(name) || !(yield* isDirectory(path.join(workspaceRoot, relativePath)))) {
        continue;
      }
      const hasGit = yield* fs
        .exists(path.join(workspaceRoot, relativePath, ".git"))
        .pipe(Effect.orElseSucceed(() => false));
      if (hasGit) found.push(relativePath);
      else if (depth < MAX_SCAN_DEPTH) yield* walk(relativePath, depth + 1);
    }
  });
  yield* walk("", 1);
  return yield* Effect.forEach(found.toSorted(), describeRepository);
});

const ProjectRootRequest = Schema.Struct({ projectId: ProjectId });
const ProjectRootRow = Schema.Struct({ workspaceRoot: Schema.String });
const TagRow = Schema.Struct({
  threadId: ThreadId,
  worktreePath: Schema.NullOr(Schema.String),
  type: Schema.String,
  fileName: Schema.NullOr(Schema.String),
  changesJson: Schema.NullOr(Schema.String),
  commandInput: Schema.NullOr(Schema.String),
  toolFilePath: Schema.NullOr(Schema.String),
});

const decodeChanges = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(OrchestrationV2FileChangeDetail)),
);

export class NestedRepositories extends Context.Service<
  NestedRepositories,
  {
    readonly list: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<OrchestrationNestedRepository>, NestedRepositoriesError>;
    readonly threadTags: (
      projectId: ProjectId,
    ) => Effect.Effect<Readonly<Record<string, ReadonlyArray<string>>>, NestedRepositoriesError>;
  }
>()("t3/orchestration-v2/NestedRepositories") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const home = NodeOS.homedir();
  const cache = new Map<
    string,
    { readonly at: number; readonly repositories: ReadonlyArray<OrchestrationNestedRepository> }
  >();

  const projectRoot = SqlSchema.findOneOption({
    Request: ProjectRootRequest,
    Result: ProjectRootRow,
    execute: ({ projectId }) => sql`
      SELECT workspace_root AS "workspaceRoot"
      FROM projection_projects
      WHERE project_id = ${projectId} AND deleted_at IS NULL
    `,
  });

  // json_extract keeps diff and output bodies inside SQLite; only the text we scan comes out.
  const tagRows = SqlSchema.findAll({
    Request: ProjectRootRequest,
    Result: TagRow,
    execute: ({ projectId }) => sql`
      SELECT
        threads.thread_id AS "threadId",
        json_extract(threads.payload_json, '$.worktreePath') AS "worktreePath",
        items.type AS "type",
        json_extract(items.payload_json, '$.fileName') AS "fileName",
        json_extract(items.payload_json, '$.changes') AS "changesJson",
        CASE WHEN items.type = 'command_execution'
          THEN json_extract(items.payload_json, '$.input') END AS "commandInput",
        CASE WHEN items.type = 'dynamic_tool'
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

  const scan = Effect.fn("NestedRepositories.scan")(function* (workspaceRoot: string) {
    const now = yield* Clock.currentTimeMillis;
    const cached = cache.get(workspaceRoot);
    if (cached !== undefined && now - cached.at < CACHE_TTL_MILLIS) return cached.repositories;
    const repositories = yield* discover(workspaceRoot).pipe(Effect.provideContext(services));
    cache.set(workspaceRoot, { at: now, repositories });
    return repositories;
  });

  const rootOf = (projectId: ProjectId) =>
    sql
      .withTransaction(projectRoot({ projectId }))
      .pipe(
        NodeSqliteClient.readOnly,
        Effect.mapError(toError),
        Effect.map(Option.map((row) => row.workspaceRoot)),
      );

  const list: NestedRepositories["Service"]["list"] = Effect.fn("NestedRepositories.list")(
    function* (projectId) {
      const root = yield* rootOf(projectId);
      return Option.isNone(root) ? [] : yield* scan(root.value);
    },
  );

  const threadTags: NestedRepositories["Service"]["threadTags"] = Effect.fn(
    "NestedRepositories.threadTags",
  )(function* (projectId) {
    const root = yield* rootOf(projectId);
    if (Option.isNone(root)) return {};
    const repositoryPaths = (yield* scan(root.value)).map((repository) => repository.path);
    if (repositoryPaths.length === 0) return {};
    const rows = yield* sql
      .withTransaction(tagRows({ projectId }))
      .pipe(NodeSqliteClient.readOnly, Effect.mapError(toError));

    const tags = new Map<string, Set<string>>();
    for (const row of rows) {
      const roots = [row.worktreePath, root.value].filter((value) => value !== null);
      const touched = new Set<string>();
      const addPath = (path: string) => {
        const relative = relativeToWorkspace(path, roots);
        const repository = relative === null ? null : repositoryOfPath(relative, repositoryPaths);
        if (repository !== null) touched.add(repository);
      };
      if (row.type === "file_change") {
        const changes =
          row.changesJson === null
            ? undefined
            : Option.getOrUndefined(decodeChanges(row.changesJson));
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
    }
    return Object.fromEntries(
      [...tags].map(([threadId, repositories]) => [threadId, [...repositories].toSorted()]),
    );
  });

  return NestedRepositories.of({ list, threadTags });
});

export const layer = Layer.effect(NestedRepositories, make);
