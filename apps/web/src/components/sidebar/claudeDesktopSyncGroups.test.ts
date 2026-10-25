import type { ClaudeDesktopSyncItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterCounts,
  groupSelection,
  groupSyncItems,
  groupsForFilter,
  isReadyToApply,
  withGroupSelected,
} from "./claudeDesktopSyncGroups";

const item = (id: string, kind: ClaudeDesktopSyncItem["kind"]): ClaudeDesktopSyncItem => ({
  id,
  kind,
  title: id,
  detail: "",
  selectedByDefault: false,
});

const ITEMS = [
  item("a", "createInDesktop"),
  item("b", "importToT3"),
  item("c", "conflict"),
  item("d", "suggestArchiveT3"),
  item("e", "renameT3"),
  item("f", "skip"),
];

describe("groupSyncItems", () => {
  it("orders conflicts first, then each direction, then suggested archives, without skips", () => {
    const groups = groupSyncItems(ITEMS);
    expect(groups.map((group) => [group.id, group.items.map((entry) => entry.id)])).toEqual([
      ["conflicts", ["c"]],
      ["toT3", ["b", "e"]],
      ["toDesktop", ["a"]],
      ["archive", ["d"]],
    ]);
  });

  it("returns no groups when only skipped items remain", () => {
    expect(groupSyncItems([item("f", "skip")])).toEqual([]);
    expect(groupSyncItems([])).toEqual([]);
  });
});

describe("filters", () => {
  it("counts each filter and keeps only its groups", () => {
    const groups = groupSyncItems(ITEMS);
    expect(filterCounts(groups)).toEqual({ all: 5, toT3: 2, toDesktop: 1, conflicts: 1 });
    expect(groupsForFilter(groups, "toT3").map((group) => group.id)).toEqual(["toT3"]);
    expect(groupsForFilter(groups, "all")).toHaveLength(4);
  });
});

describe("selection", () => {
  it("needs a side before a conflict is ready", () => {
    const conflict = item("c", "conflict");
    const selected = new Set(["c"]);
    expect(isReadyToApply(conflict, selected, new Map())).toBe(false);
    expect(isReadyToApply(conflict, selected, new Map([["c", "t3"]]))).toBe(true);
    expect(isReadyToApply(item("b", "importToT3"), new Set(), new Map())).toBe(false);
  });

  it("reports and toggles a whole group without touching other groups", () => {
    const [, toT3] = groupSyncItems(ITEMS);
    if (toT3 === undefined) throw new Error("missing group");
    expect(groupSelection(toT3, new Set())).toBe("none");
    expect(groupSelection(toT3, new Set(["b"]))).toBe("some");
    const all = withGroupSelected(toT3, new Set(["a"]), true);
    expect([...all].toSorted()).toEqual(["a", "b", "e"]);
    expect(groupSelection(toT3, all)).toBe("all");
    expect([...withGroupSelected(toT3, all, false)]).toEqual(["a"]);
  });
});
