import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ProjectLibraryEntryStatus = Schema.Literals(["created", "edited", "deleted"]);
export type ProjectLibraryEntryStatus = typeof ProjectLibraryEntryStatus.Type;

export const ORCHESTRATION_PROJECT_LIBRARY_PAGE_LIMIT = 100;

export const OrchestrationProjectLibraryCursor = Schema.Struct({
  changedAt: IsoDateTime,
  path: TrimmedNonEmptyString,
});
export type OrchestrationProjectLibraryCursor = typeof OrchestrationProjectLibraryCursor.Type;

export const OrchestrationListProjectLibraryInput = Schema.Struct({
  projectId: ProjectId,
  limit: Schema.optionalKey(
    Schema.Int.check(
      Schema.isBetween({ minimum: 1, maximum: ORCHESTRATION_PROJECT_LIBRARY_PAGE_LIMIT }),
    ),
  ),
  /** Legacy offset paging; ignored when `cursor` is set. */
  offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  /** Keyset position: the last entry of the previous page. */
  cursor: Schema.optionalKey(OrchestrationProjectLibraryCursor),
});
export type OrchestrationListProjectLibraryInput = typeof OrchestrationListProjectLibraryInput.Type;

export const OrchestrationProjectLibraryEntry = Schema.Struct({
  /** Workspace-relative so worktree threads and the main checkout share one row per file. */
  path: TrimmedNonEmptyString,
  status: ProjectLibraryEntryStatus,
  threadId: ThreadId,
  threadTitle: Schema.String,
  changedAt: IsoDateTime,
});
export type OrchestrationProjectLibraryEntry = typeof OrchestrationProjectLibraryEntry.Type;

export const OrchestrationListProjectLibraryResult = Schema.Struct({
  entries: Schema.Array(OrchestrationProjectLibraryEntry),
  total: Schema.Int,
  nextOffset: Schema.NullOr(Schema.Int),
  nextCursor: Schema.NullOr(OrchestrationProjectLibraryCursor),
});
export type OrchestrationListProjectLibraryResult =
  typeof OrchestrationListProjectLibraryResult.Type;

export class OrchestrationListProjectLibraryError extends Schema.TaggedError<OrchestrationListProjectLibraryError>()(
  "OrchestrationListProjectLibraryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
