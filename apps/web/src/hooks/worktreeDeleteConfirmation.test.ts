import { describe, expect, it } from "vite-plus/test";

import {
  buildRemovedDirtyNestedRepositoriesNotice,
  buildWorktreeDeleteMessage,
  resolveWithin,
} from "./worktreeDeleteConfirmation";

describe("resolveWithin", () => {
  it("returns the work result when it settles in time", async () => {
    expect(await resolveWithin(50, 0, async () => 3)).toBe(3);
  });

  it("falls back when the work never settles", async () => {
    expect(await resolveWithin(10, 0, () => new Promise<number>(() => {}))).toBe(0);
  });

  it("falls back when the work rejects", async () => {
    expect(
      await resolveWithin(50, 0, async () => {
        throw new Error("lookup failed");
      }),
    ).toBe(0);
  });
});

describe("buildWorktreeDeleteMessage", () => {
  it("keeps the plain confirmation when no inner repository is dirty", () => {
    expect(
      buildWorktreeDeleteMessage({ worktreePath: "~/w/feature", dirtyNestedRepositories: 0 }),
    ).toBe(
      [
        "This thread is the only one linked to this worktree:",
        "~/w/feature",
        "",
        "Delete the worktree too?",
      ].join("\n"),
    );
  });

  it("names a single dirty inner repository before the question", () => {
    const message = buildWorktreeDeleteMessage({
      worktreePath: "~/w/feature",
      dirtyNestedRepositories: 1,
    });
    expect(message).toContain("1 inner repository has uncommitted changes that will be lost.");
    expect(message.endsWith("Delete the worktree too?")).toBe(true);
  });

  it("pluralizes the count for several dirty inner repositories", () => {
    expect(
      buildWorktreeDeleteMessage({ worktreePath: "~/w/feature", dirtyNestedRepositories: 3 }),
    ).toContain("3 inner repositories have uncommitted changes that will be lost.");
  });

  it("warns when the inner repositories could not be checked", () => {
    const message = buildWorktreeDeleteMessage({
      worktreePath: "~/w/feature",
      dirtyNestedRepositories: null,
    });
    expect(message).toContain(
      "Inner repositories could not be checked. Any uncommitted changes in them will be lost.",
    );
    expect(message.endsWith("Delete the worktree too?")).toBe(true);
  });

  it("explains an unwarned removal after the fact", () => {
    expect(buildRemovedDirtyNestedRepositoriesNotice(2)).toBe(
      "2 inner repositories had uncommitted changes that were deleted with the worktree.",
    );
  });
});
