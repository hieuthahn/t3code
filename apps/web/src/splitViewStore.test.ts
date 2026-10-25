import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useSplitViewStore } from "./splitViewStore";

describe("splitViewStore.prune", () => {
  beforeEach(() => {
    useSplitViewStore.setState({ panes: [], focusKey: null });
  });

  it("drops persisted panes whose thread is gone so they stop counting toward the cap", () => {
    useSplitViewStore.setState({ panes: ["env:a", "env:dead", "env:b"], focusKey: "env:a" });

    expect(useSplitViewStore.getState().open("env:c").status).toBe("full");
    useSplitViewStore.getState().prune((key) => key !== "env:dead");

    expect(useSplitViewStore.getState().panes).toEqual(["env:a", "env:b"]);
    expect(useSplitViewStore.getState().open("env:c").status).toBe("opened");
  });

  it("leaves the panes alone when every thread is available", () => {
    useSplitViewStore.setState({ panes: ["env:a", "env:b"], focusKey: "env:a" });

    useSplitViewStore.getState().prune(() => true);

    expect(useSplitViewStore.getState().panes).toEqual(["env:a", "env:b"]);
  });
});
