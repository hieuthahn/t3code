import type { ClaudeDesktopSyncItem, ClaudeDesktopSyncItemKind } from "@t3tools/contracts";

export type SyncSide = "desktop" | "t3";

export type SyncGroupId = "conflicts" | "toT3" | "toDesktop" | "archive";

export type SyncFilter = "all" | "toT3" | "toDesktop" | "conflicts";

export interface SyncGroup {
  readonly id: SyncGroupId;
  readonly title: string;
  readonly items: ReadonlyArray<ClaudeDesktopSyncItem>;
}

const GROUP_OF_KIND: Record<Exclude<ClaudeDesktopSyncItemKind, "skip">, SyncGroupId> = {
  conflict: "conflicts",
  importToT3: "toT3",
  renameT3: "toT3",
  archiveT3: "toT3",
  createInDesktop: "toDesktop",
  renameDesktop: "toDesktop",
  archiveDesktop: "toDesktop",
  suggestArchiveT3: "archive",
  suggestArchiveDesktop: "archive",
};

const GROUP_TITLES: Record<SyncGroupId, string> = {
  conflicts: "Needs your choice",
  toT3: "Into T3",
  toDesktop: "Into Claude Desktop",
  archive: "Suggested archives",
};

const GROUP_ORDER: ReadonlyArray<SyncGroupId> = ["conflicts", "toT3", "toDesktop", "archive"];

const FILTER_GROUPS: Record<SyncFilter, ReadonlySet<SyncGroupId>> = {
  all: new Set(GROUP_ORDER),
  toT3: new Set(["toT3"]),
  toDesktop: new Set(["toDesktop"]),
  conflicts: new Set(["conflicts"]),
};

/** The short verb a row shows; the group heading already says which side changes. */
export const SYNC_ACTION_VERBS: Record<ClaudeDesktopSyncItemKind, string> = {
  importToT3: "Import",
  createInDesktop: "Add",
  renameT3: "Rename",
  renameDesktop: "Rename",
  archiveT3: "Archive state",
  archiveDesktop: "Archive state",
  suggestArchiveT3: "Archive",
  suggestArchiveDesktop: "Archive",
  conflict: "Conflict",
  skip: "Skipped",
};

/** Where a suggested archive lands, since that group mixes both apps. */
export const archiveSide = (item: ClaudeDesktopSyncItem): SyncSide | null =>
  item.kind === "suggestArchiveT3"
    ? "t3"
    : item.kind === "suggestArchiveDesktop"
      ? "desktop"
      : null;

/** Actionable items in display order, with empty groups left out. */
export function groupSyncItems(
  items: ReadonlyArray<ClaudeDesktopSyncItem>,
): ReadonlyArray<SyncGroup> {
  const byGroup = new Map<SyncGroupId, ClaudeDesktopSyncItem[]>();
  for (const item of items) {
    if (item.kind === "skip") continue;
    const id = GROUP_OF_KIND[item.kind];
    const bucket = byGroup.get(id);
    if (bucket === undefined) byGroup.set(id, [item]);
    else bucket.push(item);
  }
  return GROUP_ORDER.flatMap((id) => {
    const groupItems = byGroup.get(id);
    return groupItems === undefined ? [] : [{ id, title: GROUP_TITLES[id], items: groupItems }];
  });
}

export const groupsForFilter = (groups: ReadonlyArray<SyncGroup>, filter: SyncFilter) =>
  groups.filter((group) => FILTER_GROUPS[filter].has(group.id));

export function filterCounts(groups: ReadonlyArray<SyncGroup>): Record<SyncFilter, number> {
  const count = (id: SyncGroupId) => groups.find((group) => group.id === id)?.items.length ?? 0;
  return {
    all: groups.reduce((total, group) => total + group.items.length, 0),
    toT3: count("toT3"),
    toDesktop: count("toDesktop"),
    conflicts: count("conflicts"),
  };
}

/** An item applies once it is selected, and a conflict also needs a side. */
export const isReadyToApply = (
  item: ClaudeDesktopSyncItem,
  selected: ReadonlySet<string>,
  sides: ReadonlyMap<string, SyncSide>,
) => selected.has(item.id) && (item.kind !== "conflict" || sides.has(item.id));

export type GroupSelection = "all" | "some" | "none";

export function groupSelection(group: SyncGroup, selected: ReadonlySet<string>): GroupSelection {
  const picked = group.items.filter((item) => selected.has(item.id)).length;
  return picked === 0 ? "none" : picked === group.items.length ? "all" : "some";
}

export function withGroupSelected(
  group: SyncGroup,
  selected: ReadonlySet<string>,
  on: boolean,
): ReadonlySet<string> {
  const next = new Set(selected);
  for (const item of group.items) {
    if (on) next.add(item.id);
    else next.delete(item.id);
  }
  return next;
}
