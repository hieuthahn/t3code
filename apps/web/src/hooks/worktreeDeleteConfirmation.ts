/** Longest the delete confirmation waits to learn which inner repositories are dirty. */
export const DIRTY_NESTED_REPOSITORY_LOOKUP_MS = 4_000;

/** Resolves with `fallback` when `work` is still pending after `milliseconds`. */
export async function resolveWithin<T>(
  milliseconds: number,
  fallback: T,
  work: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), milliseconds);
  });
  try {
    return await Promise.race([work().catch(() => fallback), expiry]);
  } finally {
    clearTimeout(timer);
  }
}

function describeDirtyInnerRepositories(count: number): string {
  return `${count} inner ${count === 1 ? "repository has" : "repositories have"} uncommitted changes that will be lost.`;
}

/** Builds the confirm text shown before deleting the only worktree a thread uses. */
export function buildWorktreeDeleteMessage(input: {
  readonly worktreePath: string;
  readonly dirtyNestedRepositories: number;
}): string {
  return [
    "This thread is the only one linked to this worktree:",
    input.worktreePath,
    ...(input.dirtyNestedRepositories > 0
      ? ["", describeDirtyInnerRepositories(input.dirtyNestedRepositories)]
      : []),
    "",
    "Delete the worktree too?",
  ].join("\n");
}

/** Describes dirty inner repositories the server removed without a prior warning. */
export function buildRemovedDirtyNestedRepositoriesNotice(count: number): string {
  return `${count} inner ${count === 1 ? "repository" : "repositories"} had uncommitted changes that were deleted with the worktree.`;
}
