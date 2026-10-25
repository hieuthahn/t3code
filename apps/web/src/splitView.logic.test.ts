import { describe, expect, it } from "vite-plus/test";

import {
  MAX_SPLIT_PANES,
  closePane,
  followRouteThread,
  openPane,
  pruneUnavailablePanes,
  resolveVisiblePaneCount,
  visiblePanes,
} from "./splitView.logic";

describe("openPane", () => {
  it("appends a new thread and reports it as opened", () => {
    expect(openPane(["a"], "b")).toEqual({ panes: ["a", "b"], status: "opened" });
  });

  it("dedupes a thread that already has a pane", () => {
    expect(openPane(["a", "b"], "a")).toEqual({ panes: ["a", "b"], status: "exists" });
  });

  it("refuses a pane beyond the cap and keeps the layout", () => {
    const full = ["a", "b", "c"];
    expect(full).toHaveLength(MAX_SPLIT_PANES);
    expect(openPane(full, "d")).toEqual({ panes: full, status: "full" });
  });
});

describe("closePane", () => {
  it("focuses the neighbour that takes the closed pane's place", () => {
    expect(closePane(["a", "b", "c"], "b")).toEqual({ panes: ["a", "c"], nextFocusKey: "c" });
  });

  it("falls back to the previous pane when the last one closes", () => {
    expect(closePane(["a", "b"], "b")).toEqual({ panes: ["a"], nextFocusKey: "a" });
  });

  it("returns to single view when one pane remains", () => {
    expect(closePane(["a", "b"], "a")).toEqual({ panes: ["b"], nextFocusKey: "b" });
  });

  it("ignores a key that has no pane", () => {
    expect(closePane(["a", "b"], "z")).toEqual({ panes: ["a", "b"], nextFocusKey: null });
  });
});

describe("pruneUnavailablePanes", () => {
  it("drops deleted or archived threads and picks a survivor to focus", () => {
    const live = new Set(["a", "c"]);
    expect(pruneUnavailablePanes(["a", "b", "c"], "b", (key) => live.has(key))).toEqual({
      panes: ["a", "c"],
      nextFocusKey: "c",
    });
  });

  it("keeps the focus when the focused pane survives", () => {
    expect(pruneUnavailablePanes(["a", "b"], "a", (key) => key === "a")).toEqual({
      panes: ["a"],
      nextFocusKey: "a",
    });
  });

  it("clears everything when no thread is left", () => {
    expect(pruneUnavailablePanes(["a", "b"], "a", () => false)).toEqual({
      panes: [],
      nextFocusKey: null,
    });
  });

  it("leaves the same array untouched when every pane is available", () => {
    const panes = ["a", "b"];
    expect(pruneUnavailablePanes(panes, "a", () => true).panes).toBe(panes);
  });
});

describe("followRouteThread", () => {
  it("keeps the layout when the route thread already has a pane", () => {
    const panes = ["a", "b"];
    expect(followRouteThread(panes, "a", "b")).toBe(panes);
  });

  it("swaps the previously focused pane for an unrelated route thread", () => {
    expect(followRouteThread(["a", "b"], "b", "z")).toEqual(["a", "z"]);
  });

  it("starts a single pane when the previous thread had no pane", () => {
    expect(followRouteThread(["a", "b"], null, "z")).toEqual(["z"]);
  });

  it("treats a lone pane as single view", () => {
    expect(followRouteThread(["a"], "a", "z")).toEqual(["z"]);
  });
});

describe("resolveVisiblePaneCount", () => {
  it("fits as many panes as the width allows up to the cap", () => {
    expect(resolveVisiblePaneCount({ availableWidth: 2000, minPaneWidth: 480, paneCount: 3 })).toBe(
      3,
    );
    expect(resolveVisiblePaneCount({ availableWidth: 1000, minPaneWidth: 480, paneCount: 3 })).toBe(
      2,
    );
  });

  it("never drops below one pane", () => {
    expect(resolveVisiblePaneCount({ availableWidth: 200, minPaneWidth: 480, paneCount: 3 })).toBe(
      1,
    );
  });

  it("does not exceed the number of panes", () => {
    expect(resolveVisiblePaneCount({ availableWidth: 4000, minPaneWidth: 480, paneCount: 2 })).toBe(
      2,
    );
  });
});

describe("visiblePanes", () => {
  it("returns every pane when they all fit", () => {
    expect(visiblePanes(["a", "b"], "a", 3)).toEqual(["a", "b"]);
  });

  it("keeps the focused pane in view when panes are hidden", () => {
    expect(visiblePanes(["a", "b", "c"], "c", 2)).toEqual(["b", "c"]);
    expect(visiblePanes(["a", "b", "c"], "a", 2)).toEqual(["a", "b"]);
  });

  it("shows only the focused pane at one slot", () => {
    expect(visiblePanes(["a", "b", "c"], "b", 1)).toEqual(["b"]);
  });
});
