export type FileChangeOutputStatus = "created" | "edited" | "deleted";

export interface FileChangeEntry {
  readonly operation?: string | undefined;
  readonly path: string;
  readonly oldPath?: string | undefined;
}

export interface FileChangeOutput<Meta> {
  readonly status: FileChangeOutputStatus;
  readonly meta: Meta;
}

function statusForOperation(operation: string | undefined): FileChangeOutputStatus {
  if (operation === "add" || operation === "create") return "created";
  if (operation === "delete") return "deleted";
  return "edited";
}

/** Providers without per-file details report only the item's file name. */
export function fileChangeEntries(item: {
  readonly fileName: string;
  readonly changes?: ReadonlyArray<FileChangeEntry> | undefined;
}): ReadonlyArray<FileChangeEntry> {
  return item.changes && item.changes.length > 0
    ? item.changes
    : [{ operation: undefined, path: item.fileName, oldPath: undefined }];
}

/**
 * Folds one file_change item into a path map. A rename drops the old path, and
 * an edit after a create keeps the file "created". Apply items oldest first.
 */
export function applyFileChanges<Meta>(
  byPath: Map<string, FileChangeOutput<Meta>>,
  changes: ReadonlyArray<FileChangeEntry>,
  meta: Meta,
): void {
  for (const change of changes) {
    if (change.oldPath !== undefined) byPath.delete(change.oldPath);
    const previous = byPath.get(change.path);
    const next = statusForOperation(change.operation);
    byPath.set(change.path, {
      status: previous?.status === "created" && next === "edited" ? "created" : next,
      meta,
    });
  }
}
