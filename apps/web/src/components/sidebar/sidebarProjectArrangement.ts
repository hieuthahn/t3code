export interface ProjectArrangement {
  readonly order: readonly string[];
  readonly pinned: readonly string[];
}

/** Put pinned groups first, then groups in the saved order, keeping the given order for the rest. */
export function arrangeProjectGroups<T extends { readonly id: string }>(
  groups: readonly T[],
  arrangement: ProjectArrangement,
): T[] {
  const rankOf = (id: string) => {
    const savedIndex = arrangement.order.indexOf(id);
    return savedIndex === -1 ? Number.POSITIVE_INFINITY : savedIndex;
  };
  return groups
    .map((group, givenIndex) => ({ group, givenIndex }))
    .toSorted((left, right) => {
      const pinnedFirst =
        Number(arrangement.pinned.includes(right.group.id)) -
        Number(arrangement.pinned.includes(left.group.id));
      if (pinnedFirst !== 0) return pinnedFirst;
      const leftRank = rankOf(left.group.id);
      const rightRank = rankOf(right.group.id);
      if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1;
      return left.givenIndex - right.givenIndex;
    })
    .map(({ group }) => group);
}

/** Pin or unpin one project, keeping each project at most once. */
export function withProjectPinned(pinned: readonly string[], id: string, pin: boolean): string[] {
  const others = pinned.filter((entry) => entry !== id);
  return pin ? [...others, id] : others;
}
