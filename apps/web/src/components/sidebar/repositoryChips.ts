export const MAX_REPOSITORY_CHIPS = 2;

export interface RepositoryChipSummary {
  readonly labels: readonly string[];
  readonly overflow: number;
}

/** Shorten a nested repository path to its last segment, dropping a leading project folder. */
export function repositoryShortName(path: string, projectFolder?: string | null): string {
  const segments = path.split("/").filter((segment) => segment !== "");
  const rest =
    projectFolder != null && segments.length > 1 && segments[0] === projectFolder
      ? segments.slice(1)
      : segments;
  return rest.at(-1) ?? path;
}

/** Keep the first two repositories as chips and count the rest, or return null when there is nothing to show. */
export function summarizeRepositoryChips(
  repositories: readonly string[] | undefined,
  projectFolder?: string | null,
): RepositoryChipSummary | null {
  if (repositories === undefined || repositories.length === 0) return null;
  const labels = [...new Set(repositories.map((path) => repositoryShortName(path, projectFolder)))];
  return {
    labels: labels.slice(0, MAX_REPOSITORY_CHIPS),
    overflow: Math.max(0, labels.length - MAX_REPOSITORY_CHIPS),
  };
}
