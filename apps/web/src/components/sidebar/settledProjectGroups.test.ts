import { describe, expect, it } from "vite-plus/test";

import {
  groupSettledThreads,
  resolveSettledGroupTargets,
  settledThreadActivityMs,
  type SettledGroupProject,
} from "./settledProjectGroups";

function project(workspaceRoot: string, isScratch = false): SettledGroupProject {
  const label = workspaceRoot.split("/").findLast(Boolean) ?? "/";
  return { key: workspaceRoot, label, workspaceRoot, isScratch };
}

const PROJECTS = [
  project("/"),
  project("/Applications/Open Design.app/Contents/Resources/app/prebundled"),
  project("/Users/me"),
  project("/Users/me/Developer/t3code/apps/server"),
  project("/Users/me/Workspace"),
  project("/Users/me/Workspace/margin"),
  project("/Users/me/Workspace/Org"),
  project("/Users/me/Workspace/Org/app"),
  project("/Users/me/Workspace/Org/stuffs"),
  project("/Users/me/Workspace/Org/stuffs/bench"),
  project("/Users/me/Workspace/Org/stuffs/bench/work/runs/T1/C0/r1/workspace"),
  project("/Users/me/Workspace/Org/stuffs/bench/work/runs/T2/C1/r2/workspace"),
  project("/Users/me/Workspace/Org/trial/inquiry"),
  project("/Users/me/Workspace/margin-two/docs/design"),
  project("/Users/me/Workspace/margin-two"),
  project("/Users/me/Library/Application Support/Claude/scratch-workspaces/a/b/scratch-1"),
  project("/Users/me/.t3/scratch/thread-1", true),
];

describe("resolveSettledGroupTargets", () => {
  const targets = resolveSettledGroupTargets(PROJECTS);
  const groupOf = (workspaceRoot: string) => targets.get(workspaceRoot)?.id;

  it("keeps an umbrella project with several subtrees as its own group", () => {
    expect(groupOf("/Users/me/Workspace/Org")).toBe("/Users/me/Workspace/Org");
    expect(groupOf("/Users/me/Workspace/Org/app")).toBe("/Users/me/Workspace/Org/app");
    expect(groupOf("/Users/me/Workspace/Org/trial/inquiry")).toBe(
      "/Users/me/Workspace/Org/trial/inquiry",
    );
  });

  it("folds deep worktrees into the outermost project above a single subtree", () => {
    expect(groupOf("/Users/me/Workspace/Org/stuffs/bench")).toBe("/Users/me/Workspace/Org/stuffs");
    expect(groupOf("/Users/me/Workspace/Org/stuffs/bench/work/runs/T1/C0/r1/workspace")).toBe(
      "/Users/me/Workspace/Org/stuffs",
    );
    expect(groupOf("/Users/me/Workspace/margin-two/docs/design")).toBe(
      "/Users/me/Workspace/margin-two",
    );
  });

  it("never folds a project into the filesystem root or the home folder", () => {
    expect(groupOf("/Applications/Open Design.app/Contents/Resources/app/prebundled")).toBe(
      "/Applications/Open Design.app/Contents/Resources/app/prebundled",
    );
    expect(groupOf("/Users/me/Developer/t3code/apps/server")).toBe(
      "/Users/me/Developer/t3code/apps/server",
    );
    expect(groupOf("/Users/me/Workspace")).toBe("/Users/me/Workspace");
  });

  it("puts T3 and Claude Desktop scratch workspaces in one Scratch group", () => {
    expect(
      targets.get("/Users/me/Library/Application Support/Claude/scratch-workspaces/a/b/scratch-1"),
    ).toEqual({ id: "scratch", label: "Scratch" });
    expect(groupOf("/Users/me/.t3/scratch/thread-1")).toBe("scratch");
  });
});

describe("groupSettledThreads", () => {
  const targets = resolveSettledGroupTargets([
    project("/w/alpha"),
    project("/w/alpha/sub/deep"),
    project("/w/beta"),
  ]);
  const thread = (id: string, projectKey: string, activityMs: number) => ({
    id,
    projectKey,
    activityMs,
  });

  it("orders groups and their threads by most recent activity", () => {
    const groups = groupSettledThreads({
      threads: [
        thread("a1", "/w/alpha", 10),
        thread("b1", "/w/beta", 30),
        thread("a2", "/w/alpha/sub/deep", 20),
        thread("x1", "/missing", 5),
      ],
      targets,
      projectKeyOf: (entry) => entry.projectKey,
      activityMsOf: (entry) => entry.activityMs,
    });
    expect(groups.map((group) => [group.label, group.threads.map((entry) => entry.id)])).toEqual([
      ["beta", ["b1"]],
      ["alpha", ["a2", "a1"]],
      ["Other", ["x1"]],
    ]);
  });
});

describe("settledThreadActivityMs", () => {
  it("prefers the latest user or run timestamp over updatedAt", () => {
    expect(
      settledThreadActivityMs({
        latestUserMessageAt: "2026-10-01T00:00:00.000Z",
        latestRun: null,
        updatedAt: "2026-10-20T00:00:00.000Z",
      }),
    ).toBe(Date.parse("2026-10-01T00:00:00.000Z"));
  });

  it("falls back to updatedAt when the thread has no activity", () => {
    expect(
      settledThreadActivityMs({
        latestUserMessageAt: null,
        latestRun: null,
        updatedAt: "2026-10-20T00:00:00.000Z",
      }),
    ).toBe(Date.parse("2026-10-20T00:00:00.000Z"));
  });
});
