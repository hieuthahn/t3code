import type {
  OrchestrationNestedRepository,
  OrchestrationProjectLibraryEntry,
} from "@t3tools/contracts";

export const ALL_REPOSITORIES_FILTER = "all";
export const OUTER_REPOSITORY_FILTER = "outer";

export interface LibraryGroup {
  /** The nested repository path, or null for the outer repository. */
  readonly repository: string | null;
  readonly label: string;
  readonly entries: readonly OrchestrationProjectLibraryEntry[];
}

/** Encode a nested repository path as a filter value that cannot collide with the two fixed ones. */
export function repositoryFilterValue(path: string): string {
  return `repo:${path}`;
}

/** Return the nested repository path a filter selects, or null for All and the outer repository. */
export function nestedRepositoryOfFilter(filter: string): string | null {
  return filter.startsWith("repo:") ? filter.slice("repo:".length) : null;
}

/** Keep the rows a filter selects; a nested repository is also filtered by the server, the outer one only here. */
export function applyRepositoryFilter(
  entries: readonly OrchestrationProjectLibraryEntry[],
  filter: string,
): OrchestrationProjectLibraryEntry[] {
  if (filter === ALL_REPOSITORIES_FILTER) return [...entries];
  const nested = nestedRepositoryOfFilter(filter);
  return entries.filter((entry) => entry.repository === nested);
}

/**
 * Group rows by repository: the outer repository first under the project's name, then nested ones by path.
 * A project without nested repositories gets no groups, so its list stays flat.
 */
export function groupLibraryEntries(
  entries: readonly OrchestrationProjectLibraryEntry[],
  input: {
    readonly projectTitle: string;
    readonly repositories: readonly OrchestrationNestedRepository[];
  },
): LibraryGroup[] {
  if (input.repositories.length === 0) return [];
  const byRepository = new Map<string | null, OrchestrationProjectLibraryEntry[]>();
  for (const entry of entries) {
    const group = byRepository.get(entry.repository);
    if (group === undefined) byRepository.set(entry.repository, [entry]);
    else group.push(entry);
  }
  const nestedPaths = [...byRepository.keys()]
    .filter((key): key is string => key !== null)
    .toSorted((left, right) => left.localeCompare(right));
  const keys = [...(byRepository.has(null) ? [null] : []), ...nestedPaths];
  return keys.map((key) => ({
    repository: key,
    label: key ?? input.projectTitle,
    entries: byRepository.get(key) ?? [],
  }));
}
