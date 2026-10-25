import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

export type ThreadOutputStatus = "created" | "edited" | "deleted";

export interface ThreadOutput {
  readonly path: string;
  readonly status: ThreadOutputStatus;
}

function statusForOperation(operation: string | undefined): ThreadOutputStatus {
  if (operation === "add" || operation === "create") return "created";
  if (operation === "delete") return "deleted";
  return "edited";
}

/** Files the thread changed, newest first, one row per path. */
export function deriveThreadOutputs(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlyArray<ThreadOutput> {
  const byPath = new Map<string, { status: ThreadOutputStatus; ordinal: number }>();
  const ordered = items
    .filter((item) => item.type === "file_change" && item.status === "completed")
    .toSorted((left, right) => left.ordinal - right.ordinal);
  for (const item of ordered) {
    if (item.type !== "file_change") continue;
    const changes =
      item.changes && item.changes.length > 0
        ? item.changes
        : [{ operation: undefined, path: item.fileName, oldPath: undefined }];
    for (const change of changes) {
      if (change.oldPath !== undefined) byPath.delete(change.oldPath);
      const previous = byPath.get(change.path);
      const next = statusForOperation(change.operation);
      byPath.set(change.path, {
        status: previous?.status === "created" && next === "edited" ? "created" : next,
        ordinal: item.ordinal,
      });
    }
  }
  return [...byPath]
    .toSorted(([, left], [, right]) => right.ordinal - left.ordinal)
    .map(([path, { status }]) => ({ path, status }));
}
