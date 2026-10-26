import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import {
  applyFileChanges,
  fileChangeEntries,
  type FileChangeOutput,
  type FileChangeOutputStatus,
} from "@t3tools/shared/fileChangeOutputs";

export type ThreadOutputStatus = FileChangeOutputStatus;

export interface ThreadOutput {
  readonly path: string;
  readonly status: ThreadOutputStatus;
}

/** Files the thread changed, newest first, one row per path. */
export function deriveThreadOutputs(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlyArray<ThreadOutput> {
  const byPath = new Map<string, FileChangeOutput<number>>();
  const ordered = items
    .filter((item) => item.type === "file_change" && item.status === "completed")
    .toSorted((left, right) => left.ordinal - right.ordinal);
  for (const item of ordered) {
    if (item.type !== "file_change") continue;
    applyFileChanges(byPath, fileChangeEntries(item), item.ordinal);
  }
  return [...byPath]
    .toSorted(([, left], [, right]) => right.meta - left.meta)
    .map(([path, { status }]) => ({ path, status }));
}
