import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2FileChangeDetail,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as NestedRepositories from "./NestedRepositories.ts";
import * as ProjectStore from "./ProjectStore.ts";

const layerTest = Layer.mergeAll(
  NestedRepositories.layer,
  ProjectionStore.layer,
  ProjectStore.layer,
).pipe(Layer.provideMerge(SqlitePersistence.layerMemory), Layer.provideMerge(NodeServices.layer));

const providerInstanceId = ProviderInstanceId.make("codex");
const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 8, 27, 0, minute));

const createProject = (projectId: ProjectId, workspaceRoot: string) =>
  Effect.flatMap(ProjectStore.ProjectStoreV2, (projects) =>
    projects.apply({
      sequence: 0,
      eventId: EventId.make(`created:${projectId}`),
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: DateTime.formatIso(at(0)),
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId,
        title: projectId,
        workspaceRoot,
        defaultModelSelection: null,
        scripts: [],
        createdAt: DateTime.formatIso(at(0)),
        updatedAt: DateTime.formatIso(at(0)),
      },
    }),
  );

const thread = (
  threadId: ThreadId,
  projectId: ProjectId,
  overrides: { readonly worktreePath?: string; readonly deletedAt?: DateTime.Utc } = {},
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`created:${threadId}`),
  type: "thread.created",
  threadId,
  providerInstanceId,
  occurredAt: at(0),
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId,
    title: `Title of ${threadId}`,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: overrides.worktreePath ?? null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: at(0),
    updatedAt: at(0),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: overrides.deletedAt ?? null,
  },
});

const turnItem = (
  threadId: ThreadId,
  id: string,
  minute: number,
  body: Record<string, unknown>,
): OrchestrationV2DomainEvent =>
  ({
    id: EventId.make(`item:${id}`),
    type: "turn-item.updated",
    threadId,
    occurredAt: at(minute),
    payload: {
      id: TurnItemId.make(id),
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: minute,
      status: "completed",
      title: null,
      startedAt: at(minute),
      completedAt: at(minute),
      updatedAt: at(minute),
      ...body,
    },
  }) as OrchestrationV2DomainEvent;

const command = (threadId: ThreadId, id: string, minute: number, input: string) =>
  turnItem(threadId, id, minute, { type: "command_execution", input });

const tool = (threadId: ThreadId, id: string, minute: number, input: unknown, toolName = "Edit") =>
  turnItem(threadId, id, minute, { type: "dynamic_tool", toolName, input });

const fileChange = (
  threadId: ThreadId,
  id: string,
  minute: number,
  changes: ReadonlyArray<OrchestrationV2FileChangeDetail>,
) =>
  turnItem(threadId, id, minute, {
    type: "file_change",
    fileName: changes[0]?.path ?? "unknown",
    changes,
  });

const seed = (events: ReadonlyArray<OrchestrationV2DomainEvent>) =>
  Effect.flatMap(ProjectionStore.ProjectionStoreV2, (projections) =>
    Effect.forEach(events, projections.apply, { discard: true }),
  );

const write = Effect.fn("test.write")(function* (file: string, content = "") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(file), { recursive: true });
  yield* fs.writeFileString(file, content);
});

const gitDirectory = Effect.fn("test.gitDirectory")(function* (
  directory: string,
  branch: string,
  origin?: string,
) {
  const path = yield* Path.Path;
  yield* write(path.join(directory, "HEAD"), `ref: refs/heads/${branch}\n`);
  yield* write(
    path.join(directory, "config"),
    [
      "[core]\n\tbare = false",
      ...(origin === undefined ? [] : [`[remote "origin"]\n\turl = ${origin}\n\tfetch = +refs/*`]),
    ].join("\n"),
  );
});

const makeWorkspace = Effect.fn("test.makeWorkspace")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectory({ prefix: "nested-repos-" });
  yield* gitDirectory(path.join(root, ".git"), "main");
  yield* gitDirectory(path.join(root, "backend/.git"), "develop", "git@host:org/backend.git");
  yield* gitDirectory(path.join(root, "apps/admin/.git"), "feature/x");
  yield* gitDirectory(path.join(root, "gitdirs/wt"), "wt-branch", "git@host:org/wt.git");
  yield* write(path.join(root, "wt/.git"), "gitdir: ../gitdirs/wt\n");
  yield* write(path.join(root, "plain/readme.md"));
  yield* gitDirectory(path.join(root, "node_modules/pkg/.git"), "main");
  yield* gitDirectory(path.join(root, ".claude/worktrees/x/.git"), "main");
  yield* gitDirectory(path.join(root, ".hidden/.git"), "main");
  yield* gitDirectory(path.join(root, "deep/a/b/.git"), "main");
  yield* gitDirectory(path.join(root, "apps/vendor/.git"), "main");
  yield* gitDirectory(path.join(root, "apps/Pods/.git"), "main");
  yield* gitDirectory(path.join(root, "vendor/.git"), "main");
  return root;
});

const tags = (projectId: ProjectId) =>
  Effect.flatMap(NestedRepositories.NestedRepositories, (service) => service.threadTags(projectId));

it.layer(layerTest)("NestedRepositories", (it) => {
  it.effect("lists nothing for a project without nested repositories", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectory({ prefix: "no-nested-" });
      yield* write(path.join(root, "src/index.ts"));
      const project = ProjectId.make("project:none");
      yield* createProject(project, root);

      const service = yield* NestedRepositories.NestedRepositories;
      assert.deepEqual(yield* service.list(project), []);
      assert.deepEqual(yield* tags(project), {});
    }),
  );

  it.effect("finds depth 1 and 2 repositories, reading .git files and skipping ignored dirs", () =>
    Effect.gen(function* () {
      const root = yield* makeWorkspace();
      const project = ProjectId.make("project:discover");
      yield* createProject(project, root);

      const service = yield* NestedRepositories.NestedRepositories;
      assert.deepEqual(yield* service.list(project), [
        { path: "apps/admin", name: "admin", branch: "feature/x", originUrl: null },
        {
          path: "backend",
          name: "backend",
          branch: "develop",
          originUrl: "git@host:org/backend.git",
        },
        { path: "vendor", name: "vendor", branch: "main", originUrl: null },
        { path: "wt", name: "wt", branch: "wt-branch", originUrl: "git@host:org/wt.git" },
      ]);
    }),
  );

  it.effect("tags a thread that touches two repositories through every item kind", () =>
    Effect.gen(function* () {
      const root = yield* makeWorkspace();
      const project = ProjectId.make("project:tags");
      const threadId = ThreadId.make("thread:tags");
      yield* createProject(project, root);
      yield* seed([
        thread(threadId, project),
        command(threadId, "c1", 1, `cat ${root}/backend/src/a.ts`),
        tool(threadId, "t1", 2, { file_path: `${root}/apps/admin/src/b.vue`, old_string: "x" }),
      ]);

      assert.deepEqual(yield* tags(project), { [threadId]: ["apps/admin", "backend"] });
    }),
  );

  it.effect("reads absolute and relative cd forms and ignores paths outside the project", () =>
    Effect.gen(function* () {
      const root = yield* makeWorkspace();
      const project = ProjectId.make("project:cd");
      const absolute = ThreadId.make("thread:cd-absolute");
      const relative = ThreadId.make("thread:cd-relative");
      const chained = ThreadId.make("thread:cd-chained");
      const outside = ThreadId.make("thread:cd-outside");
      yield* createProject(project, root);
      yield* seed([
        thread(absolute, project),
        thread(relative, project),
        thread(chained, project),
        thread(outside, project),
        command(absolute, "a1", 1, `cd "${root}/backend" && git status`),
        command(relative, "r1", 2, "cd apps/admin/src && ls"),
        command(chained, "ch1", 3, "cd ./wt/ ; cd ../backend && git log"),
        command(outside, "o1", 4, "cd /etc && cat /tmp/backend/file ; cd ../backend"),
        tool(outside, "o2", 5, { file_path: "/somewhere/else/backend/a.ts" }),
      ]);

      assert.deepEqual(yield* tags(project), {
        [absolute]: ["backend"],
        [relative]: ["apps/admin"],
        [chained]: ["backend", "wt"],
      });
    }),
  );

  it.effect("tags file_change items and ignores paths in the outer repository", () =>
    Effect.gen(function* () {
      const root = yield* makeWorkspace();
      const project = ProjectId.make("project:file-change");
      const threadId = ThreadId.make("thread:file-change");
      const outer = ThreadId.make("thread:outer");
      yield* createProject(project, root);
      yield* seed([
        thread(threadId, project),
        thread(outer, project),
        fileChange(threadId, "f1", 1, [{ operation: "edit", path: `${root}/wt/x.ts` }]),
        fileChange(outer, "f2", 2, [{ operation: "edit", path: "docs/readme.md" }]),
        command(outer, "c2", 3, "ls backend-notes && cat backendish/file"),
      ]);

      assert.deepEqual(yield* tags(project), { [threadId]: ["wt"] });
    }),
  );

  it.effect("counts dynamic_tool items only for write and edit tools", () =>
    Effect.gen(function* () {
      const root = yield* makeWorkspace();
      const project = ProjectId.make("project:tools");
      const reader = ThreadId.make("thread:reader");
      const writer = ThreadId.make("thread:writer");
      yield* createProject(project, root);
      yield* seed([
        thread(reader, project),
        thread(writer, project),
        tool(reader, "r1", 1, { file_path: `${root}/backend/a.ts` }, "Read"),
        tool(writer, "w1", 2, { file_path: `${root}/backend/a.ts` }, "write_file"),
      ]);

      assert.deepEqual(yield* tags(project), { [writer]: ["backend"] });
    }),
  );

  it.effect("tags file_change items from stored paths including old paths", () =>
    Effect.gen(function* () {
      const root = yield* makeWorkspace();
      const project = ProjectId.make("project:rename");
      const threadId = ThreadId.make("thread:rename");
      yield* createProject(project, root);
      yield* seed([
        thread(threadId, project),
        fileChange(threadId, "f1", 1, [
          { operation: "rename", path: `${root}/wt/new.ts`, oldPath: `${root}/backend/old.ts` },
        ]),
      ]);

      assert.deepEqual(yield* tags(project), { [threadId]: ["backend", "wt"] });
    }),
  );
});
