import { describe, expect, it } from "vite-plus/test";

import {
  arrangeProjectGroups,
  moveProjectGroup,
  projectGroupDropIndex,
  withProjectPinned,
} from "./sidebarProjectArrangement";

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

describe("moveProjectGroup", () => {
  const displayed = ["p1", "p2", "a", "b", "c"];
  const pinned = ["p2", "p1"];

  it("moves an unpinned group and keeps saved groups that are not on screen", () => {
    expect(moveProjectGroup({ displayed, pinned, saved: ["x", "a"], id: "c", toIndex: 2 })).toEqual(
      ["p1", "p2", "c", "a", "b", "x"],
    );
  });

  it("keeps unpinned groups below the pinned ones", () => {
    expect(moveProjectGroup({ displayed, pinned, saved: [], id: "b", toIndex: 0 })).toEqual([
      "p1",
      "p2",
      "b",
      "a",
      "c",
    ]);
  });

  it("keeps pinned groups among the pinned ones", () => {
    expect(moveProjectGroup({ displayed, pinned, saved: [], id: "p1", toIndex: 4 })).toEqual([
      "p2",
      "p1",
      "a",
      "b",
      "c",
    ]);
  });

  it("returns null when the group does not move", () => {
    expect(moveProjectGroup({ displayed, pinned, saved: [], id: "a", toIndex: 0 })).toBeNull();
    expect(moveProjectGroup({ displayed, pinned, saved: [], id: "c", toIndex: 9 })).toBeNull();
    expect(moveProjectGroup({ displayed, pinned, saved: [], id: "z", toIndex: 0 })).toBeNull();
  });
});

describe("projectGroupDropIndex", () => {
  it("counts the other headers whose middle sits above the pointer", () => {
    expect(projectGroupDropIndex([10, 50, 90], 5)).toBe(0);
    expect(projectGroupDropIndex([10, 50, 90], 60)).toBe(2);
    expect(projectGroupDropIndex([10, 50, 90], 200)).toBe(3);
  });
});
