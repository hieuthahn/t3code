import { describe, expect, it } from "vite-plus/test";

import { everythingFolded, foldEverything, type SidebarFoldState } from "./sidebarFoldAll";

const OPEN: SidebarFoldState = {
  collapsedBuckets: [],
  settledShelfExpanded: true,
  expandedSettledGroupIds: ["p1", "p2"],
};

describe("everythingFolded", () => {
  it("is null when nothing can fold", () => {
    expect(
      everythingFolded(OPEN, { bucketMarkers: [], hasSettledShelf: false, settledGroupIds: [] }),
    ).toBeNull();
  });

  it("counts the Settled shelf alone in Comfortable mode", () => {
    const targets = { bucketMarkers: [], hasSettledShelf: true, settledGroupIds: [] };
    expect(everythingFolded(OPEN, targets)).toBe(false);
    expect(everythingFolded({ ...OPEN, settledShelfExpanded: false }, targets)).toBe(true);
  });

  it("needs every bucket, the shelf and every settled group folded", () => {
    const targets = { bucketMarkers: ["a", "b"], hasSettledShelf: true, settledGroupIds: ["p1"] };
    expect(
      everythingFolded(
        { collapsedBuckets: ["a", "b"], settledShelfExpanded: true, expandedSettledGroupIds: [] },
        targets,
      ),
    ).toBe(false);
    expect(
      everythingFolded(
        { collapsedBuckets: ["a"], settledShelfExpanded: false, expandedSettledGroupIds: [] },
        targets,
      ),
    ).toBe(false);
    expect(
      everythingFolded(
        {
          collapsedBuckets: ["a", "b"],
          settledShelfExpanded: false,
          expandedSettledGroupIds: ["p1"],
        },
        targets,
      ),
    ).toBe(true);
  });
});

describe("foldEverything", () => {
  const targets = {
    bucketMarkers: ["a", "b"],
    hasSettledShelf: true,
    settledGroupIds: ["p1", "p3"],
  };

  it("folds the visible buckets, the Settled shelf and every settled group", () => {
    expect(foldEverything({ ...OPEN, collapsedBuckets: ["z"] }, targets, true)).toEqual({
      collapsedBuckets: ["z", "a", "b"],
      settledShelfExpanded: false,
      expandedSettledGroupIds: ["p2"],
    });
  });

  it("opens every bucket fold, the Settled shelf and every settled group", () => {
    expect(
      foldEverything(
        {
          collapsedBuckets: ["z", "a", "time-bucket:settled:today"],
          settledShelfExpanded: false,
          expandedSettledGroupIds: ["p2"],
        },
        targets,
        false,
      ),
    ).toEqual({
      collapsedBuckets: [],
      settledShelfExpanded: true,
      expandedSettledGroupIds: ["p2", "p1", "p3"],
    });
  });

  it("leaves the shelf alone when there is no Settled shelf", () => {
    expect(
      foldEverything(
        OPEN,
        { bucketMarkers: ["a"], hasSettledShelf: false, settledGroupIds: [] },
        true,
      ).settledShelfExpanded,
    ).toBe(true);
  });
});
