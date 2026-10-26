import * as NodeOS from "node:os";

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
import * as ProjectLibrary from "./ProjectLibrary.ts";
import * as ProjectStore from "./ProjectStore.ts";

const layerTest = Layer.mergeAll(
  ProjectLibrary.layer.pipe(Layer.provideMerge(NestedRepositories.layer)),
  ProjectionStore.layer,
  ProjectStore.layer,
).pipe(Layer.provideMerge(SqlitePersistence.layerMemory), Layer.provideMerge(NodeServices.layer));

const providerInstanceId = ProviderInstanceId.make("codex");
const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 8, 27, 0, minute));
const rootOf = (projectId: ProjectId) => `/work/${projectId}`;

const createProject = (projectId: ProjectId, workspaceRoot = rootOf(projectId)) =>
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

const fileChange = (
  threadId: ThreadId,
  id: string,
  minute: number,
  changes: ReadonlyArray<OrchestrationV2FileChangeDetail>,
  options: { readonly status?: "completed" | "running"; readonly ordinal?: number } = {},
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`file-change:${id}`),
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
    ordinal: options.ordinal ?? minute,
    status: options.status ?? "completed",
    title: null,
    startedAt: at(minute),
    completedAt: at(minute),
    updatedAt: at(minute),
    type: "file_change",
    fileName: changes[0]?.path ?? "unknown",
    changes,
  },
});

const seed = (events: ReadonlyArray<OrchestrationV2DomainEvent>) =>
  Effect.flatMap(ProjectionStore.ProjectionStoreV2, (projections) =>
    Effect.forEach(events, projections.apply, { discard: true }),
  );

const list = (
  projectId: ProjectId,
  page: {
    limit?: number;
    offset?: number;
    cursor?: { changedAt: string; path: string };
    repository?: string;
    scope?: "outer" | "outside";
  } = {},
) =>
  Effect.flatMap(ProjectLibrary.ProjectLibrary, (library) => library.list({ projectId, ...page }));

it.layer(layerTest)("ProjectLibrary", (it) => {
  it.effect("returns an empty page for a project without file changes", () =>
    Effect.gen(function* () {
      const project = ProjectId.make("project:empty");
      yield* createProject(project);
      yield* seed([thread(ThreadId.make("thread:empty"), project)]);

      assert.deepEqual(yield* list(project), {
        entries: [],
        total: 0,
        nextOffset: null,
        nextCursor: null,
      });
    }),
  );

  it.effect("drops the old path on rename and keeps deleted files", () =>
    Effect.gen(function* () {
      const project = ProjectId.make("project:rename");
      const threadId = ThreadId.make("thread:rename");
      yield* createProject(project);
      yield* seed([
        thread(threadId, project),
        fileChange(threadId, "item:create", 1, [{ operation: "add", path: "src/a.ts" }]),
        fileChange(threadId, "item:rename", 2, [
          { operation: "rename", path: "src/b.ts", oldPath: "src/a.ts" },
        ]),
        fileChange(threadId, "item:delete", 3, [{ operation: "delete", path: "docs/old.md" }]),
      ]);

      const result = yield* list(project);
      assert.deepEqual(
        result.entries.map((entry) => [entry.path, entry.status]),
        [
          ["docs/old.md", "deleted"],
          ["src/b.ts", "created"],
        ],
      );
    }),
  );

  it.effect("credits the latest thread when two threads touch one path", () =>
    Effect.gen(function* () {
      const project = ProjectId.make("project:latest");
      const first = ThreadId.make("thread:first");
      const second = ThreadId.make("thread:second");
      yield* createProject(project);
      yield* seed([
        thread(first, project),
        thread(second, project),
        fileChange(second, "item:second", 5, [{ operation: "edit", path: "src/shared.ts" }]),
        fileChange(first, "item:first", 2, [{ operation: "add", path: "src/shared.ts" }]),
        fileChange(first, "item:running", 9, [{ operation: "edit", path: "src/shared.ts" }], {
          status: "running",
        }),
      ]);

      const result = yield* list(project);
      assert.lengthOf(result.entries, 1);
      assert.deepEqual(
        [result.entries[0]?.threadId, result.entries[0]?.threadTitle, result.entries[0]?.status],
        [second, "Title of thread:second", "created"],
      );
    }),
  );

  it.effect("normalizes worktree and workspace absolute paths to one row", () =>
    Effect.gen(function* () {
      const project = ProjectId.make("project:worktree");
      const main = ThreadId.make("thread:main");
      const worktree = ThreadId.make("thread:worktree");
      yield* createProject(project);
      yield* seed([
        thread(main, project),
        thread(worktree, project, { worktreePath: "/wt/feature" }),
        fileChange(main, "item:main", 1, [
          { operation: "edit", path: `${rootOf(project)}/src/app.ts` },
        ]),
        fileChange(worktree, "item:worktree", 2, [
          { operation: "edit", path: "/wt/feature/src/app.ts" },
          { operation: "edit", path: "./README.md" },
        ]),
      ]);

      const result = yield* list(project);
      assert.deepEqual(
        result.entries.map((entry) => [entry.path, entry.threadId]),
        [
          ["README.md", worktree],
          ["src/app.ts", worktree],
        ],
      );
    }),
  );

  it.effect("ignores deleted threads and other projects", () =>
    Effect.gen(function* () {
      const project = ProjectId.make("project:scope");
      const other = ProjectId.make("project:scope-other");
      const gone = ThreadId.make("thread:gone");
      const elsewhere = ThreadId.make("thread:elsewhere");
      yield* createProject(project);
      yield* createProject(other);
      yield* seed([
        thread(gone, project, { deletedAt: at(1) }),
        thread(elsewhere, other),
        fileChange(gone, "item:gone", 1, [{ operation: "edit", path: "gone.ts" }]),
        fileChange(elsewhere, "item:elsewhere", 1, [{ operation: "edit", path: "other.ts" }]),
      ]);

      assert.deepEqual((yield* list(project)).entries, []);
    }),
  );

  it.effect("pages newest first with a next offset until the last page", () =>
    Effect.gen(function* () {
      const project = ProjectId.make("project:pages");
      const threadId = ThreadId.make("thread:pages");
      yield* createProject(project);
      yield* seed([
        thread(threadId, project),
        ...[1, 2, 3, 4, 5].map((minute) =>
          fileChange(threadId, `item:page-${minute}`, minute, [
            { operation: "edit", path: `file-${minute}.ts` },
          ]),
        ),
      ]);

      const firstPage = yield* list(project, { limit: 2 });
      assert.deepEqual(
        [firstPage.entries.map((entry) => entry.path), firstPage.total, firstPage.nextOffset],
        [["file-5.ts", "file-4.ts"], 5, 2],
      );
      const lastPage = yield* list(project, { limit: 2, offset: 4 });
      assert.deepEqual(
        [lastPage.entries.map((entry) => entry.path), lastPage.nextOffset],
        [["file-1.ts"], null],
      );
    }),
  );

  it.effect("treats backslashes as separators", () =>
    Effect.gen(function* () {
      const project = ProjectId.make("project:backslash");
      const threadId = ThreadId.make("thread:backslash");
      yield* createProject(project);
      yield* seed([
        thread(threadId, project, { worktreePath: "C:\\wt\\feature" }),
        fileChange(threadId, "item:backslash", 1, [
          { operation: "edit", path: "C:\\wt\\feature\\src\\app.ts" },
        ]),
      ]);

      assert.deepEqual(
        (yield* list(project)).entries.map((entry) => entry.path),
        ["src/app.ts"],
      );
    }),
  );

  it.effect("matches roots that differ only by the macOS /private prefix", () =>
    Effect.gen(function* () {
      const project = ProjectId.make("project:private");
      const main = ThreadId.make("thread:private-main");
      const worktree = ThreadId.make("thread:private-wt");
      yield* createProject(project);
      yield* seed([
        thread(main, project),
        thread(worktree, project, { worktreePath: "/private/var/wt/feature" }),
        fileChange(main, "item:private-main", 1, [
          { operation: "edit", path: `/private${rootOf(project)}/src/app.ts` },
        ]),
        fileChange(worktree, "item:private-wt", 2, [
          { operation: "edit", path: "/var/wt/feature/src/app.ts" },
        ]),
      ]);

      const result = yield* list(project);
      assert.deepEqual(
        result.entries.map((entry) => [entry.path, entry.threadId]),
        [["src/app.ts", worktree]],
      );
    }),
  );

  it.effect("shows paths outside the workspace with the home directory as ~", () =>
    Effect.gen(function* () {
      const project = ProjectId.make("project:outside");
      const threadId = ThreadId.make("thread:outside");
      yield* createProject(project);
      yield* seed([
        thread(threadId, project),
        fileChange(threadId, "item:outside", 1, [
          { operation: "edit", path: `${NodeOS.homedir()}/notes/todo.md` },
          { operation: "edit", path: "/etc/hosts" },
        ]),
      ]);

      assert.deepEqual((yield* list(project)).entries.map((entry) => entry.path).toSorted(), [
        "/etc/hosts",
        "~/notes/todo.md",
      ]);
    }),
  );

  it.effect("keeps a renamed file created at its new path", () =>
    Effect.gen(function* () {
      const project = ProjectId.make("project:rename-created");
      const threadId = ThreadId.make("thread:rename-created");
      yield* createProject(project);
      yield* seed([
        thread(threadId, project),
        fileChange(threadId, "item:rc-create", 1, [{ operation: "add", path: "a.ts" }]),
        fileChange(threadId, "item:rc-rename", 2, [
          { operation: "rename", path: "b.ts", oldPath: "a.ts" },
        ]),
      ]);

      assert.deepEqual(
        (yield* list(project)).entries.map((entry) => [entry.path, entry.status]),
        [["b.ts", "created"]],
      );
    }),
  );

  it.effect(
    "pages by keyset cursor without duplicating or skipping a file changed between pages",
    () =>
      Effect.gen(function* () {
        const project = ProjectId.make("project:cursor");
        const threadId = ThreadId.make("thread:cursor");
        yield* createProject(project);
        yield* seed([
          thread(threadId, project),
          ...[1, 2, 3, 4, 5].map((minute) =>
            fileChange(threadId, `item:cursor-${minute}`, minute, [
              { operation: "edit", path: `file-${minute}.ts` },
            ]),
          ),
        ]);

        const firstPage = yield* list(project, { limit: 2 });
        assert.deepEqual(
          firstPage.entries.map((entry) => entry.path),
          ["file-5.ts", "file-4.ts"],
        );
        assert.isNotNull(firstPage.nextCursor);

        yield* seed([
          fileChange(threadId, "item:cursor-touch", 9, [{ operation: "edit", path: "file-3.ts" }]),
        ]);

        const secondPage = yield* list(project, { limit: 2, cursor: firstPage.nextCursor! });
        assert.deepEqual(
          secondPage.entries.map((entry) => entry.path),
          ["file-2.ts", "file-1.ts"],
        );
        assert.isNull(secondPage.nextCursor);
      }),
  );
  it.effect("assigns rows to their nested repository and filters by repository", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectory({ prefix: "library-repos-" });
      for (const directory of ["backend/.git", "apps/admin/.git", "docs"]) {
        yield* fs.makeDirectory(path.join(root, directory), { recursive: true });
      }
      const project = ProjectId.make("project:repos");
      const threadId = ThreadId.make("thread:repos");
      yield* createProject(project, root);
      yield* seed([
        thread(threadId, project),
        fileChange(threadId, "item:outer", 1, [{ operation: "edit", path: "docs/a.md" }]),
        fileChange(threadId, "item:backend", 2, [
          { operation: "edit", path: `${root}/backend/src/app.ts` },
        ]),
        fileChange(threadId, "item:admin", 3, [
          { operation: "edit", path: "apps/admin/src/main.ts" },
        ]),
        fileChange(threadId, "item:sibling", 4, [{ operation: "edit", path: "backend-notes.md" }]),
      ]);

      const all = yield* list(project);
      assert.deepEqual(
        all.entries.map((entry) => [entry.path, entry.repository]),
        [
          ["backend-notes.md", null],
          ["apps/admin/src/main.ts", "apps/admin"],
          ["backend/src/app.ts", "backend"],
          ["docs/a.md", null],
        ],
      );

      const filtered = yield* list(project, { repository: "backend" });
      assert.deepEqual(
        filtered.entries.map((entry) => entry.path),
        ["backend/src/app.ts"],
      );
      assert.equal(filtered.total, 1);
    }),
  );

  it.effect("separates files outside the project folder and filters them server-side", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectory({ prefix: "library-outside-" });
      yield* fs.makeDirectory(path.join(root, "backend/.git"), { recursive: true });
      const project = ProjectId.make("project:outside");
      const threadId = ThreadId.make("thread:outside");
      yield* createProject(project, root);
      yield* seed([
        thread(threadId, project),
        fileChange(threadId, "item:outer", 1, [{ operation: "edit", path: "docs/a.md" }]),
        fileChange(threadId, "item:backend", 2, [{ operation: "edit", path: "backend/app.ts" }]),
        fileChange(threadId, "item:outside", 3, [
          { operation: "edit", path: "/elsewhere/notes.md" },
        ]),
      ]);

      const all = yield* list(project);
      assert.deepEqual(
        all.entries.map((entry) => [entry.path, entry.outsideProject]),
        [
          ["/elsewhere/notes.md", true],
          ["backend/app.ts", false],
          ["docs/a.md", false],
        ],
      );
      assert.deepEqual(
        (yield* list(project, { scope: "outside" })).entries.map((entry) => entry.path),
        ["/elsewhere/notes.md"],
      );
      const outer = yield* list(project, { scope: "outer" });
      assert.deepEqual(
        outer.entries.map((entry) => entry.path),
        ["docs/a.md"],
      );
      assert.equal(outer.total, 1);
    }),
  );

  it.effect("leaves repository null when the project has no nested repositories", () =>
    Effect.gen(function* () {
      const project = ProjectId.make("project:repos-none");
      const threadId = ThreadId.make("thread:repos-none");
      yield* createProject(project);
      yield* seed([
        thread(threadId, project),
        fileChange(threadId, "item:none", 1, [{ operation: "edit", path: "src/a.ts" }]),
      ]);

      assert.deepEqual(
        (yield* list(project)).entries.map((entry) => entry.repository),
        [null],
      );
    }),
  );

  it.effect("keeps absolute dot-directory files under the project root in the outer repository", () =>
    Effect.gen(function* () {
      const project = ProjectId.make("project:dot-directory");
      const threadId = ThreadId.make("thread:dot-directory");
      yield* createProject(project);
      yield* seed([
        thread(threadId, project),
        fileChange(threadId, "item:hora-1", 1, [
          { operation: "edit", path: `${rootOf(project)}/.hora/acceptance/1.3.0/learning.md` },
        ]),
        fileChange(threadId, "item:hora-2", 2, [
          { operation: "edit", path: `${rootOf(project)}/.hora/acceptance/1.3.0/learning.md` },
        ]),
      ]);

      const result = yield* list(project, { scope: "outer" });
      assert.deepEqual(
        result.entries.map((entry) => [entry.path, entry.repository, entry.outsideProject]),
        [[".hora/acceptance/1.3.0/learning.md", null, false]],
      );
    }),
  );
});
