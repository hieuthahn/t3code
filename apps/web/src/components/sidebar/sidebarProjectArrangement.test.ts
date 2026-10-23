import { describe, expect, it } from "vite-plus/test";

import { arrangeProjectGroups, withProjectPinned } from "./sidebarProjectArrangement";

const groups = ["a", "b", "c", "d"].map((id) => ({ id }));
const idsOf = (list: readonly { id: string }[]) => list.map((group) => group.id);

describe("arrangeProjectGroups", () => {
  it("keeps the given order when nothing is pinned or ordered", () => {
    expect(idsOf(arrangeProjectGroups(groups, { order: [], pinned: [] }))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("lifts pinned groups to the top in their given order", () => {
    expect(idsOf(arrangeProjectGroups(groups, { order: [], pinned: ["d", "b"] }))).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });

  it("places ordered groups first and leaves new groups after them", () => {
    expect(idsOf(arrangeProjectGroups(groups, { order: ["c", "a"], pinned: [] }))).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });

  it("orders pinned groups by the saved order too", () => {
    expect(
      idsOf(arrangeProjectGroups(groups, { order: ["d", "c", "b"], pinned: ["b", "d"] })),
    ).toEqual(["d", "b", "c", "a"]);
  });
});

describe("withProjectPinned", () => {
  it("pins a project once", () => {
    expect(withProjectPinned(["a"], "b", true)).toEqual(["a", "b"]);
    expect(withProjectPinned(["a"], "a", true)).toEqual(["a"]);
  });

  it("unpins a project", () => {
    expect(withProjectPinned(["a", "b"], "a", false)).toEqual(["b"]);
  });
});
