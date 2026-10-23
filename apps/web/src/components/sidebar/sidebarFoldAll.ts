import { everyBucketCollapsed, withBucketsCollapsed } from "./sidebarTimeBuckets";

export interface SidebarFoldState {
  readonly collapsedBuckets: readonly string[];
  readonly settledShelfExpanded: boolean;
  readonly expandedSettledGroupIds: readonly string[];
}

export interface SidebarFoldTargets {
  readonly bucketMarkers: readonly string[];
  readonly hasSettledShelf: boolean;
  readonly settledGroupIds: readonly string[];
}

/** Tell whether every foldable part of the sidebar is folded; null when nothing can fold. */
export function everythingFolded(
  state: SidebarFoldState,
  targets: SidebarFoldTargets,
): boolean | null {
  const { bucketMarkers, hasSettledShelf, settledGroupIds } = targets;
  if (bucketMarkers.length === 0 && !hasSettledShelf && settledGroupIds.length === 0) return null;
  const bucketsFolded =
    bucketMarkers.length === 0 || everyBucketCollapsed(bucketMarkers, state.collapsedBuckets);
  const shelfFolded = !hasSettledShelf || !state.settledShelfExpanded;
  const groupsFolded =
    !state.settledShelfExpanded ||
    settledGroupIds.every((id) => !state.expandedSettledGroupIds.includes(id));
  return bucketsFolded && shelfFolded && groupsFolded;
}

/** Fold the visible buckets, the Settled shelf and its groups, or open every one of them. */
export function foldEverything(
  state: SidebarFoldState,
  targets: SidebarFoldTargets,
  fold: boolean,
): SidebarFoldState {
  const otherGroupIds = state.expandedSettledGroupIds.filter(
    (id) => !targets.settledGroupIds.includes(id),
  );
  return {
    collapsedBuckets: fold
      ? withBucketsCollapsed(state.collapsedBuckets, targets.bucketMarkers, true)
      : [],
    settledShelfExpanded: targets.hasSettledShelf ? !fold : state.settledShelfExpanded,
    expandedSettledGroupIds: fold ? otherGroupIds : [...otherGroupIds, ...targets.settledGroupIds],
  };
}
