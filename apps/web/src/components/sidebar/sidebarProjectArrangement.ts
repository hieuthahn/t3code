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

/** Move a group to a display index within its pinned or unpinned run, returning the order to save. */
export function moveProjectGroup(input: {
  readonly displayed: readonly string[];
  readonly pinned: readonly string[];
  readonly saved: readonly string[];
  readonly id: string;
  readonly toIndex: number;
}): string[] | null {
  const { displayed, pinned, saved, id } = input;
  const fromIndex = displayed.indexOf(id);
  if (fromIndex === -1) return null;
  const pinnedCount = displayed.filter((entry) => pinned.includes(entry)).length;
  const [lowest, highest] = pinned.includes(id)
    ? [0, pinnedCount - 1]
    : [pinnedCount, displayed.length - 1];
  const toIndex = Math.min(Math.max(input.toIndex, lowest), highest);
  if (toIndex === fromIndex) return null;
  const moved = displayed.filter((entry) => entry !== id);
  moved.splice(toIndex, 0, id);
  return [...moved, ...saved.filter((entry) => !displayed.includes(entry))];
}

/** Count the other group headers whose vertical middle sits above the pointer. */
export function projectGroupDropIndex(headerMiddles: readonly number[], pointerY: number): number {
  return headerMiddles.filter((middle) => middle < pointerY).length;
}
