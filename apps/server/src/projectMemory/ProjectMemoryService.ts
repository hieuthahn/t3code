import {
  PROJECT_MEMORY_MAX_TEXT_CHARS,
  ProjectMemoryError,
  type ProjectId,
  type ProjectMemoryAppendInput,
  type ProjectMemoryDeleteInput,
  type ProjectMemoryEditInput,
  type ProjectMemoryEntry,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { renderProjectMemoryDigest } from "./projectMemoryDigest.ts";
import { makeProjectMemoryStore } from "./projectMemoryStore.ts";

export class ProjectMemoryService extends Context.Service<
  ProjectMemoryService,
  {
    /** Every entry of the project, newest first. */
    readonly list: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<ProjectMemoryEntry>, ProjectMemoryError>;
    readonly subscribe: (
      projectId: ProjectId,
    ) => Stream.Stream<ReadonlyArray<ProjectMemoryEntry>, ProjectMemoryError>;
    readonly append: (
      input: ProjectMemoryAppendInput,
    ) => Effect.Effect<ProjectMemoryEntry, ProjectMemoryError>;
    readonly edit: (
      input: ProjectMemoryEditInput,
    ) => Effect.Effect<ProjectMemoryEntry, ProjectMemoryError>;
    readonly delete: (input: ProjectMemoryDeleteInput) => Effect.Effect<void, ProjectMemoryError>;
    /** The framed digest a thread's first run starts with, or nothing when the project has no memory. */
    readonly digest: (
      projectId: ProjectId,
    ) => Effect.Effect<string | undefined, ProjectMemoryError>;
  }
>()("t3/projectMemory/ProjectMemoryService") {}

/** The trimmed text, or an error that says what is wrong with it. */
const checkMemoryText = (text: string): Effect.Effect<string, ProjectMemoryError> => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return Effect.fail(new ProjectMemoryError({ message: "A memory entry cannot be empty." }));
  }
  if (trimmed.length > PROJECT_MEMORY_MAX_TEXT_CHARS) {
    return Effect.fail(
      new ProjectMemoryError({
        message: `A memory entry holds at most ${PROJECT_MEMORY_MAX_TEXT_CHARS} characters; this one has ${trimmed.length}. Shorten it to the one decision or fact worth keeping.`,
      }),
    );
  }
  return Effect.succeed(trimmed);
};

export const layer = Layer.effect(
  ProjectMemoryService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const crypto = yield* Crypto.Crypto;
    const changes = yield* PubSub.unbounded<ProjectId>();
    const store = makeProjectMemoryStore(sql, changes);
    const newId = crypto.randomUUIDv4().pipe(Effect.orDie);
    const notFound = new ProjectMemoryError({ message: "That memory entry no longer exists." });

    const list: ProjectMemoryService["Service"]["list"] = (projectId) => store.list(projectId);

    const subscribe: ProjectMemoryService["Service"]["subscribe"] = (projectId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          return Stream.concat(
            Stream.fromEffect(store.list(projectId)),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((changed) => changed === projectId),
              Stream.mapEffect(() => store.list(projectId)),
            ),
          );
        }),
      );

    const append: ProjectMemoryService["Service"]["append"] = Effect.fn("ProjectMemory.append")(
      function* (input) {
        const text = yield* checkMemoryText(input.text);
        return yield* store.insert({
          id: `memory:${yield* newId}`,
          projectId: input.projectId,
          text,
          authorThreadId: input.authorThreadId,
        });
      },
    );

    const edit: ProjectMemoryService["Service"]["edit"] = Effect.fn("ProjectMemory.edit")(
      function* (input) {
        const text = yield* checkMemoryText(input.text);
        const entry = yield* store.update({
          projectId: input.projectId,
          entryId: input.entryId,
          text,
        });
        return entry ?? (yield* Effect.fail(notFound));
      },
    );

    const remove: ProjectMemoryService["Service"]["delete"] = Effect.fn("ProjectMemory.delete")(
      function* (input) {
        if (!(yield* store.remove(input))) return yield* Effect.fail(notFound);
      },
    );

    const digest: ProjectMemoryService["Service"]["digest"] = (projectId) =>
      store.list(projectId).pipe(Effect.map((entries) => renderProjectMemoryDigest(entries)));

    return ProjectMemoryService.of({ list, subscribe, append, edit, delete: remove, digest });
  }),
);
