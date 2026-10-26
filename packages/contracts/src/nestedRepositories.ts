import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const OrchestrationNestedRepository = Schema.Struct({
  /** Relative to the project's workspace root, with forward slashes. */
  path: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  /** Null on a detached HEAD or an unreadable repository. */
  branch: Schema.NullOr(Schema.String),
  originUrl: Schema.NullOr(Schema.String),
});
export type OrchestrationNestedRepository = typeof OrchestrationNestedRepository.Type;

export const OrchestrationListNestedRepositoriesInput = Schema.Struct({
  projectId: ProjectId,
  /** Lists the repositories under this thread's worktree instead of the project root. */
  threadId: Schema.optional(ThreadId),
});
export type OrchestrationListNestedRepositoriesInput =
  typeof OrchestrationListNestedRepositoriesInput.Type;

export const OrchestrationListNestedRepositoriesResult = Schema.Struct({
  repositories: Schema.Array(OrchestrationNestedRepository),
});
export type OrchestrationListNestedRepositoriesResult =
  typeof OrchestrationListNestedRepositoriesResult.Type;

export class OrchestrationListNestedRepositoriesError extends Schema.TaggedError<OrchestrationListNestedRepositoriesError>()(
  "OrchestrationListNestedRepositoriesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const OrchestrationListThreadRepositoryTagsInput = Schema.Struct({ projectId: ProjectId });
export type OrchestrationListThreadRepositoryTagsInput =
  typeof OrchestrationListThreadRepositoryTagsInput.Type;

export const OrchestrationListThreadRepositoryTagsResult = Schema.Struct({
  /** Only threads that touched at least one nested repository appear. */
  threads: Schema.Record(ThreadId, Schema.Array(TrimmedNonEmptyString)),
  /** Per thread, how many tool calls touched each repository. Absent from older servers. */
  touchCounts: Schema.optional(
    Schema.Record(ThreadId, Schema.Record(TrimmedNonEmptyString, Schema.Number)),
  ),
});
export type OrchestrationListThreadRepositoryTagsResult =
  typeof OrchestrationListThreadRepositoryTagsResult.Type;

export class OrchestrationListThreadRepositoryTagsError extends Schema.TaggedError<OrchestrationListThreadRepositoryTagsError>()(
  "OrchestrationListThreadRepositoryTagsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
