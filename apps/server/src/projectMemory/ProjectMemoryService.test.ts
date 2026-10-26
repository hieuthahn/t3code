import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { PROJECT_MEMORY_MAX_TEXT_CHARS, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectMemoryService from "./ProjectMemoryService.ts";

const projectId = ProjectId.make("project:memory");
const otherProjectId = ProjectId.make("project:other");
const authorThreadId = ThreadId.make("thread:author");

const serviceLayer = ProjectMemoryService.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(SqlitePersistence.layerMemory, NodeServices.layer)),
);

it.effect("starts empty and renders no digest", () =>
  Effect.gen(function* () {
    const memory = yield* ProjectMemoryService.ProjectMemoryService;
    assert.deepEqual(yield* memory.list(projectId), []);
    assert.isUndefined(yield* memory.digest(projectId));
  }).pipe(Effect.provide(serviceLayer)),
);

it.effect("refuses an entry over the cap and says how far over it is", () =>
  Effect.gen(function* () {
    const memory = yield* ProjectMemoryService.ProjectMemoryService;
    const error = yield* memory
      .append({ projectId, text: "x".repeat(PROJECT_MEMORY_MAX_TEXT_CHARS + 1) })
      .pipe(Effect.flip);
    assert.equal(error._tag, "ProjectMemoryError");
    assert.include(error.message, `at most ${PROJECT_MEMORY_MAX_TEXT_CHARS} characters`);
    assert.include(error.message, `${PROJECT_MEMORY_MAX_TEXT_CHARS + 1}`);
    assert.deepEqual(yield* memory.list(projectId), []);
    const exact = yield* memory.append({
      projectId,
      text: "x".repeat(PROJECT_MEMORY_MAX_TEXT_CHARS),
    });
    assert.equal(exact.text.length, PROJECT_MEMORY_MAX_TEXT_CHARS);
  }).pipe(Effect.provide(serviceLayer)),
);

it.effect("refuses an entry with no text", () =>
  Effect.gen(function* () {
    const memory = yield* ProjectMemoryService.ProjectMemoryService;
    const error = yield* memory.append({ projectId, text: "  \n " }).pipe(Effect.flip);
    assert.include(error.message, "cannot be empty");
  }).pipe(Effect.provide(serviceLayer)),
);

it.effect("keeps both of two appends made at the same time", () =>
  Effect.gen(function* () {
    const memory = yield* ProjectMemoryService.ProjectMemoryService;
    yield* Effect.all(
      [
        memory.append({ projectId, text: "use pnpm", authorThreadId }),
        memory.append({ projectId, text: "no default exports" }),
      ],
      { concurrency: "unbounded" },
    );
    const entries = yield* memory.list(projectId);
    assert.sameMembers(
      entries.map((entry) => entry.text),
      ["use pnpm", "no default exports"],
    );
    assert.equal(new Set(entries.map((entry) => entry.id)).size, 2);
  }).pipe(Effect.provide(serviceLayer)),
);

it.effect("lists newest first and keeps projects apart", () =>
  Effect.gen(function* () {
    const memory = yield* ProjectMemoryService.ProjectMemoryService;
    yield* memory.append({ projectId, text: "first" });
    yield* memory.append({ projectId, text: "second", authorThreadId });
    yield* memory.append({ projectId: otherProjectId, text: "elsewhere" });
    const entries = yield* memory.list(projectId);
    assert.deepEqual(
      entries.map((entry) => entry.text),
      ["second", "first"],
    );
    assert.equal(entries[0]?.authorThreadId, authorThreadId);
    assert.isUndefined(entries[1]?.authorThreadId);
  }).pipe(Effect.provide(serviceLayer)),
);

it.effect("edits an entry and deletes it, refusing a missing one", () =>
  Effect.gen(function* () {
    const memory = yield* ProjectMemoryService.ProjectMemoryService;
    const entry = yield* memory.append({ projectId, text: "draft" });
    const edited = yield* memory.edit({ projectId, entryId: entry.id, text: "final" });
    assert.equal(edited.text, "final");
    assert.equal(edited.createdAt, entry.createdAt);
    assert.deepEqual(
      (yield* memory.list(projectId)).map((listed) => listed.text),
      ["final"],
    );

    const wrongProject = yield* memory
      .edit({ projectId: otherProjectId, entryId: entry.id, text: "hijack" })
      .pipe(Effect.flip);
    assert.include(wrongProject.message, "no longer exists");
    const overCap = yield* memory
      .edit({ projectId, entryId: entry.id, text: "x".repeat(PROJECT_MEMORY_MAX_TEXT_CHARS + 1) })
      .pipe(Effect.flip);
    assert.include(overCap.message, "at most");

    yield* memory.delete({ projectId, entryId: entry.id });
    assert.deepEqual(yield* memory.list(projectId), []);
    const again = yield* memory.delete({ projectId, entryId: entry.id }).pipe(Effect.flip);
    assert.include(again.message, "no longer exists");
  }).pipe(Effect.provide(serviceLayer)),
);

it.effect("tells a subscriber the new list after each change", () =>
  Effect.gen(function* () {
    const memory = yield* ProjectMemoryService.ProjectMemoryService;
    const lists = yield* Queue.unbounded<ReadonlyArray<string>>();
    yield* memory.append({ projectId, text: "before" });
    yield* memory.subscribe(projectId).pipe(
      Stream.runForEach((entries) =>
        Queue.offer(
          lists,
          entries.map((entry) => entry.text),
        ),
      ),
      Effect.forkScoped,
    );
    assert.deepEqual(yield* Queue.take(lists), ["before"]);
    yield* memory.append({ projectId: otherProjectId, text: "unseen" });
    yield* memory.append({ projectId, text: "after" });
    assert.deepEqual(yield* Queue.take(lists), ["after", "before"]);
    const newest = (yield* memory.list(projectId))[0]!;
    yield* memory.delete({ projectId, entryId: newest.id });
    assert.deepEqual(yield* Queue.take(lists), ["before"]);
  }).pipe(Effect.scoped, Effect.provide(serviceLayer)),
);
