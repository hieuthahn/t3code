import type {
  OrchestrationNestedRepository,
  OrchestrationProjectLibraryEntry,
} from "@t3tools/contracts";

export const ALL_REPOSITORIES_FILTER = "all";
export const OUTER_REPOSITORY_FILTER = "outer";
export const OUTSIDE_PROJECT_FILTER = "outside";
export const OUTSIDE_PROJECT_LABEL = "Outside project";

export interface LibraryGroup {
  /** The nested repository path, or null for the outer repository and for the outside-project group. */
  readonly repository: string | null;
  readonly outsideProject: boolean;
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

/** The server-side scope a filter asks for, or undefined when a nested repository or All does the selecting. */
export function libraryScopeOfFilter(filter: string): "outer" | "outside" | undefined {
  if (filter === OUTER_REPOSITORY_FILTER) return "outer";
  if (filter === OUTSIDE_PROJECT_FILTER) return "outside";
  return undefined;
}

/** Keep the rows a filter selects; the server filters too, so this only guards rows from a stale page. */
export function applyRepositoryFilter(
  entries: readonly OrchestrationProjectLibraryEntry[],
  filter: string,
): OrchestrationProjectLibraryEntry[] {
  if (filter === ALL_REPOSITORIES_FILTER) return [...entries];
  if (filter === OUTSIDE_PROJECT_FILTER) return entries.filter((entry) => entry.outsideProject);
  const nested = nestedRepositoryOfFilter(filter);
  return entries.filter((entry) => !entry.outsideProject && entry.repository === nested);
}

/**
 * Group rows by repository: the outer repository first under the project's name, then nested ones by path,
 * then files outside the project folder. A project with neither nested repositories nor outside files stays flat.
 */
export function groupLibraryEntries(
  entries: readonly OrchestrationProjectLibraryEntry[],
  input: {
    readonly projectTitle: string;
    readonly repositories: readonly OrchestrationNestedRepository[];
  },
): LibraryGroup[] {
  const outside = entries.filter((entry) => entry.outsideProject);
  if (input.repositories.length === 0 && outside.length === 0) return [];
  const byRepository = new Map<string | null, OrchestrationProjectLibraryEntry[]>();
  for (const entry of entries) {
    if (entry.outsideProject) continue;
    const group = byRepository.get(entry.repository);
    if (group === undefined) byRepository.set(entry.repository, [entry]);
    else group.push(entry);
  }
  const nestedPaths = [...byRepository.keys()]
    .filter((key): key is string => key !== null)
    .toSorted((left, right) => left.localeCompare(right));
  const keys = [...(byRepository.has(null) ? [null] : []), ...nestedPaths];
  const groups = keys.map((key) => ({
    repository: key,
    outsideProject: false,
    label: key ?? input.projectTitle,
    entries: byRepository.get(key) ?? [],
  }));
  return outside.length === 0
    ? groups
    : [
        ...groups,
        {
          repository: null,
          outsideProject: true,
          label: OUTSIDE_PROJECT_LABEL,
          entries: outside,
        },
      ];
}
