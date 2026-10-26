import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Longest memory entry, in characters; a longer one is refused so the digest stays small. */
export const PROJECT_MEMORY_MAX_TEXT_CHARS = 500;

/** Most entries one project keeps; a fuller memory refuses new entries so the digest stays useful. */
export const PROJECT_MEMORY_MAX_ENTRIES = 200;

export const ProjectMemoryEntryId = TrimmedNonEmptyString;
export type ProjectMemoryEntryId = typeof ProjectMemoryEntryId.Type;

export const ProjectMemoryEntry = Schema.Struct({
  id: ProjectMemoryEntryId,
  projectId: ProjectId,
  text: Schema.String,
  authorThreadId: Schema.optional(ThreadId),
  authorThreadTitle: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectMemoryEntry = typeof ProjectMemoryEntry.Type;

export const ProjectMemoryListInput = Schema.Struct({ projectId: ProjectId });
export type ProjectMemoryListInput = typeof ProjectMemoryListInput.Type;

export const ProjectMemoryAppendInput = Schema.Struct({
  projectId: ProjectId,
  text: Schema.String,
  authorThreadId: Schema.optional(ThreadId),
});
export type ProjectMemoryAppendInput = typeof ProjectMemoryAppendInput.Type;

export const ProjectMemoryEditInput = Schema.Struct({
  projectId: ProjectId,
  entryId: ProjectMemoryEntryId,
  text: Schema.String,
});
export type ProjectMemoryEditInput = typeof ProjectMemoryEditInput.Type;

export const ProjectMemoryDeleteInput = Schema.Struct({
  projectId: ProjectId,
  entryId: ProjectMemoryEntryId,
});
export type ProjectMemoryDeleteInput = typeof ProjectMemoryDeleteInput.Type;

export class ProjectMemoryError extends Schema.TaggedError<ProjectMemoryError>()(
  "ProjectMemoryError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const OrchestratorMcpProjectMemoryReadResult = Schema.Struct({
  entries: Schema.Array(ProjectMemoryEntry).annotate({
    description: "Every memory entry of this thread's project, newest first.",
  }),
});
export type OrchestratorMcpProjectMemoryReadResult =
  typeof OrchestratorMcpProjectMemoryReadResult.Type;

export const OrchestratorMcpProjectMemoryAppendInput = Schema.Struct({
  text: Schema.String.annotate({
    description: `One durable decision or fact, at most ${PROJECT_MEMORY_MAX_TEXT_CHARS} characters.`,
  }),
});
export type OrchestratorMcpProjectMemoryAppendInput =
  typeof OrchestratorMcpProjectMemoryAppendInput.Type;

export const OrchestratorMcpProjectMemoryAppendResult = Schema.Struct({
  entry: ProjectMemoryEntry,
});
export type OrchestratorMcpProjectMemoryAppendResult =
  typeof OrchestratorMcpProjectMemoryAppendResult.Type;
