export const STANDALONE_GROUP_ID = "standalone";

export interface CoordinatorGroup<T> {
  /** The thread that heads the group, or null for the Standalone group. */
  readonly coordinator: T | null;
  readonly id: string;
  readonly label: string;
  /** The coordinator, when there is one, followed by every descendant. */
  readonly threads: readonly T[];
  readonly childCount: number;
}

/**
 * Split a section into one group per thread that has child sessions, then a Standalone group for the rest.
 * Descendants join their root's group; a child whose parent has no row stays its own entry, so it lands wherever its own children put it.
 */
export function groupByCoordinator<T>(
  items: readonly T[],
  input: {
    readonly keyOf: (thread: T) => string;
    readonly titleOf: (thread: T) => string;
    readonly childrenByParentKey: ReadonlyMap<string, readonly T[]>;
  },
): CoordinatorGroup<T>[] {
  const { keyOf, titleOf, childrenByParentKey } = input;
  const groups: CoordinatorGroup<T>[] = [];
  const standalone: T[] = [];
  const descendantsOf = (parentKey: string, seen: Set<string>): T[] =>
    (childrenByParentKey.get(parentKey) ?? []).flatMap((child) => {
      const childKey = keyOf(child);
      if (seen.has(childKey)) return [];
      seen.add(childKey);
      return [child, ...descendantsOf(childKey, seen)];
    });
  const descendantsByKey = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if ((childrenByParentKey.get(key)?.length ?? 0) > 0) {
      descendantsByKey.set(key, descendantsOf(key, new Set([key])));
    }
  }
  const claimed = new Set(
    [...descendantsByKey.values()].flatMap((descendants) => descendants.map(keyOf)),
  );
  for (const item of items) {
    const key = keyOf(item);
    const descendants = descendantsByKey.get(key);
    if (claimed.has(key)) continue;
    if (descendants === undefined) {
      standalone.push(item);
      continue;
    }
    groups.push({
      coordinator: item,
      id: key,
      label: titleOf(item),
      threads: [item, ...descendants],
      childCount: descendants.length,
    });
  }
  if (standalone.length > 0) {
    groups.push({
      coordinator: null,
      id: STANDALONE_GROUP_ID,
      label: "Standalone",
      threads: standalone,
      childCount: standalone.length,
    });
  }
  return groups;
}
