import type {
  ClaudeDesktopSyncApplyInput,
  ClaudeDesktopSyncApplyResult,
  ClaudeDesktopSyncError,
  ClaudeDesktopSyncPreview,
  ClaudeDesktopSyncRequest,
  ClaudeDesktopSyncResponse,
  ClaudeDesktopSyncUndoResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { fail } from "./ClaudeDesktopSyncFiles.ts";

export const PREVIEW_TIMEOUT = "60 seconds";

/** Route one sync request; only the read-only preview is cut off, since apply must not stop halfway. */
export function makeRun(steps: {
  readonly preview: Effect.Effect<ClaudeDesktopSyncPreview, ClaudeDesktopSyncError>;
  readonly apply: (
    input: ClaudeDesktopSyncApplyInput,
  ) => Effect.Effect<ClaudeDesktopSyncApplyResult, ClaudeDesktopSyncError>;
  readonly undoLast: Effect.Effect<ClaudeDesktopSyncUndoResult, ClaudeDesktopSyncError>;
}) {
  return (
    request: ClaudeDesktopSyncRequest,
  ): Effect.Effect<ClaudeDesktopSyncResponse, ClaudeDesktopSyncError> => {
    switch (request.action) {
      case "preview":
        return steps.preview.pipe(
          Effect.withSpan("ClaudeDesktopSync.preview"),
          Effect.timeout(PREVIEW_TIMEOUT),
          Effect.catchTag("TimeoutError", () =>
            Effect.fail(
              fail(
                `Reading Claude Desktop sessions and transcripts took longer than ${PREVIEW_TIMEOUT}. Nothing was changed.`,
              ),
            ),
          ),
          Effect.map((result) => ({ preview: result })),
        );
      case "apply":
        return steps.apply(request.apply ?? { selectedIds: [], conflictChoices: [] }).pipe(
          Effect.withSpan("ClaudeDesktopSync.apply"),
          Effect.map((result) => ({ apply: result })),
        );
      case "undoLast":
        return steps.undoLast.pipe(
          Effect.withSpan("ClaudeDesktopSync.undoLast"),
          Effect.map((result) => ({ undoLast: result })),
        );
    }
  };
}
