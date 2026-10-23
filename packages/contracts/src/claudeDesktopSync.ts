import * as Schema from "effect/Schema";

export const ClaudeDesktopSyncItemKind = Schema.Literals([
  "importToT3",
  "createInDesktop",
  "renameT3",
  "renameDesktop",
  "archiveT3",
  "archiveDesktop",
  "suggestArchiveT3",
  "suggestArchiveDesktop",
  "conflict",
  "skip",
]);
export type ClaudeDesktopSyncItemKind = typeof ClaudeDesktopSyncItemKind.Type;

export const ClaudeDesktopSyncItem = Schema.Struct({
  id: Schema.String,
  kind: ClaudeDesktopSyncItemKind,
  title: Schema.String,
  detail: Schema.String,
  selectedByDefault: Schema.Boolean,
  conflictField: Schema.optional(Schema.Literals(["title", "archived"])),
  desktopValue: Schema.optional(Schema.String),
  t3Value: Schema.optional(Schema.String),
});
export type ClaudeDesktopSyncItem = typeof ClaudeDesktopSyncItem.Type;

export const ClaudeDesktopSyncPreview = Schema.Struct({
  items: Schema.Array(ClaudeDesktopSyncItem),
  desktopSessionCount: Schema.Number,
  t3ThreadCount: Schema.Number,
  pendingDesktopOpCount: Schema.Number,
  canUndo: Schema.Boolean,
});
export type ClaudeDesktopSyncPreview = typeof ClaudeDesktopSyncPreview.Type;

export const ClaudeDesktopSyncApplyInput = Schema.Struct({
  selectedIds: Schema.Array(Schema.String),
  conflictChoices: Schema.Array(
    Schema.Struct({ id: Schema.String, side: Schema.Literals(["desktop", "t3"]) }),
  ),
});
export type ClaudeDesktopSyncApplyInput = typeof ClaudeDesktopSyncApplyInput.Type;

export const ClaudeDesktopSyncFailure = Schema.Struct({ id: Schema.String, error: Schema.String });

export const ClaudeDesktopSyncApplyResult = Schema.Struct({
  runId: Schema.String,
  applied: Schema.Number,
  queuedForDesktop: Schema.Number,
  failed: Schema.Array(ClaudeDesktopSyncFailure),
});
export type ClaudeDesktopSyncApplyResult = typeof ClaudeDesktopSyncApplyResult.Type;

export const ClaudeDesktopSyncUndoResult = Schema.Struct({
  runId: Schema.NullOr(Schema.String),
  undone: Schema.Number,
  failed: Schema.Array(ClaudeDesktopSyncFailure),
});
export type ClaudeDesktopSyncUndoResult = typeof ClaudeDesktopSyncUndoResult.Type;

export const ClaudeDesktopSyncRequest = Schema.Struct({
  action: Schema.Literals(["preview", "apply", "undoLast"]),
  apply: Schema.optional(ClaudeDesktopSyncApplyInput),
});
export type ClaudeDesktopSyncRequest = typeof ClaudeDesktopSyncRequest.Type;

export const ClaudeDesktopSyncResponse = Schema.Struct({
  preview: Schema.optional(ClaudeDesktopSyncPreview),
  apply: Schema.optional(ClaudeDesktopSyncApplyResult),
  undoLast: Schema.optional(ClaudeDesktopSyncUndoResult),
});
export type ClaudeDesktopSyncResponse = typeof ClaudeDesktopSyncResponse.Type;

export class ClaudeDesktopSyncError extends Schema.TaggedError<ClaudeDesktopSyncError>()(
  "ClaudeDesktopSyncError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}
