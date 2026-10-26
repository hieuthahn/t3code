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
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectLibrary from "./ProjectLibrary.ts";
import * as ProjectStore from "./ProjectStore.ts";

const layerTest = Layer.mergeAll(
  ProjectLibrary.layer,
  ProjectionStore.layer,
  ProjectStore.layer,
).pipe(Layer.provideMerge(SqlitePersistence.layerMemory));

const providerInstanceId = ProviderInstanceId.make("codex");
const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 8, 27, 0, minute));
const rootOf = (projectId: ProjectId) => `/work/${projectId}`;

const createProject = (projectId: ProjectId) =>
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
        workspaceRoot: rootOf(projectId),
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

const list = (projectId: ProjectId, page: { limit?: number; offset?: number } = {}) =>
  Effect.flatMap(ProjectLibrary.ProjectLibrary, (library) => library.list({ projectId, ...page }));

it.layer(layerTest)("ProjectLibrary", (it) => {
  it.effect("returns an empty page for a project without file changes", () =>
    Effect.gen(function* () {
      const project = ProjectId.make("project:empty");
      yield* createProject(project);
      yield* seed([thread(ThreadId.make("thread:empty"), project)]);

      assert.deepEqual(yield* list(project), { entries: [], total: 0, nextOffset: null });
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
          ["src/b.ts", "edited"],
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
});
