import { describe, expect, it } from "vite-plus/test";

import {
  arrangeFanoutRows,
  FANOUT_GUESS_TOLERANCE_MS,
  type FanoutCandidate,
  fanoutRowThreads,
  resolveFanoutGroupIds,
} from "./fanoutGroups";

type TestThread = FanoutCandidate & { readonly key: string };

const BASE_MS = Date.parse("2026-10-23T09:00:00.000Z");

function thread(
  key: string,
  overrides: {
    readonly title?: string;
    readonly createdOffsetMs?: number;
    readonly fanoutGroupId?: string;
    readonly projectId?: string;
    readonly environmentId?: string;
    readonly parentThreadId?: string;
  } = {},
): TestThread {
  return {
    key,
    environmentId: (overrides.environmentId ?? "env-1") as TestThread["environmentId"],
    projectId: (overrides.projectId ?? "project-1") as TestThread["projectId"],
    title: overrides.title ?? "Compare sorting",
    createdAt: new Date(BASE_MS + (overrides.createdOffsetMs ?? 0)).toISOString(),
    ...(overrides.fanoutGroupId === undefined ? {} : { fanoutGroupId: overrides.fanoutGroupId }),
    lineage: {
      parentThreadId: (overrides.parentThreadId ?? null) as TestThread["lineage"]["parentThreadId"],
      relationshipToParent: overrides.parentThreadId === undefined ? null : "fork",
      rootThreadId: (overrides.parentThreadId ?? key) as TestThread["lineage"]["rootThreadId"],
    },
  };
}

const keyOf = (candidate: TestThread) => candidate.key;

describe("resolveFanoutGroupIds", () => {
  it("groups stamped threads by their fanout group even after their titles diverge", () => {
    const groups = resolveFanoutGroupIds(
      [
        thread("a", { fanoutGroupId: "send-1", title: "Haiku answer" }),
        thread("b", { fanoutGroupId: "send-1", title: "Sonnet answer", createdOffsetMs: 60_000 }),
        thread("c", { fanoutGroupId: "send-2" }),
      ],
      keyOf,
    );

    expect(groups.get("a")).toBe("env-1:send-1");
    expect(groups.get("b")).toBe("env-1:send-1");
    expect(groups.get("c")).toBe("env-1:send-2");
  });

  it("guesses a group for unstamped threads sharing project, title and creation time", () => {
    const groups = resolveFanoutGroupIds(
      [
        thread("a"),
        thread("b", { createdOffsetMs: 300 }),
        thread("c", { createdOffsetMs: FANOUT_GUESS_TOLERANCE_MS }),
      ],
      keyOf,
    );

    expect(new Set([groups.get("a"), groups.get("b"), groups.get("c")]).size).toBe(1);
    expect(groups.get("a")).toBeDefined();
  });

  it("keeps unstamped threads apart when the title, project or creation time differs", () => {
    const groups = resolveFanoutGroupIds(
      [
        thread("a"),
        thread("b", { title: "Another question", createdOffsetMs: 100 }),
        thread("c", { projectId: "project-2", createdOffsetMs: 200 }),
        thread("d", { createdOffsetMs: FANOUT_GUESS_TOLERANCE_MS + 1 }),
      ],
      keyOf,
    );

    expect(groups.size).toBe(0);
  });

  it("never mixes stamped and unstamped threads, and skips threads with a parent", () => {
    const groups = resolveFanoutGroupIds(
      [
        thread("a", { fanoutGroupId: "send-1" }),
        thread("b", { createdOffsetMs: 100 }),
        thread("c", { createdOffsetMs: 200, parentThreadId: "a" }),
      ],
      keyOf,
    );

    expect(groups.get("a")).toBe("env-1:send-1");
    expect(groups.has("b")).toBe(false);
    expect(groups.has("c")).toBe(false);
  });
});

describe("arrangeFanoutRows", () => {
  const arrange = (
    threads: readonly TestThread[],
    options: { collapsed?: readonly string[]; routeThreadKey?: string } = {},
  ) =>
    arrangeFanoutRows({
      threads,
      keyOf,
      groupIdByKey: resolveFanoutGroupIds(threads, keyOf),
      collapsedGroupIds: new Set(options.collapsed ?? []),
      routeThreadKey: options.routeThreadKey ?? null,
    });
  const describeRows = (rows: ReturnType<typeof arrange>) =>
    rows.map((row) =>
      row.kind === "group"
        ? `[${row.group.memberKeys.join(",")}]`
        : row.nested
          ? `  ${row.thread.key}`
          : row.thread.key,
    );

  it("pulls every member up under one header at the first member's place", () => {
    const rows = arrange([
      thread("x", { title: "Solo" }),
      thread("a", { fanoutGroupId: "send-1" }),
      thread("y", { title: "Other" }),
      thread("b", { fanoutGroupId: "send-1" }),
    ]);

    expect(describeRows(rows)).toEqual(["x", "[a,b]", "  a", "  b", "y"]);
  });

  it("leaves a lone member of a group flat", () => {
    const rows = arrange([
      thread("a", { fanoutGroupId: "send-1" }),
      thread("x", { title: "Solo" }),
    ]);

    expect(describeRows(rows)).toEqual(["a", "x"]);
  });

  it("hides a collapsed group's members except the route thread", () => {
    const threads = [
      thread("a", { fanoutGroupId: "send-1" }),
      thread("b", { fanoutGroupId: "send-1" }),
      thread("c", { fanoutGroupId: "send-1" }),
    ];

    const collapsed = arrange(threads, { collapsed: ["env-1:send-1"] });
    const collapsedOnRoute = arrange(threads, { collapsed: ["env-1:send-1"], routeThreadKey: "b" });

    expect(describeRows(collapsed)).toEqual(["[a,b,c]"]);
    expect(describeRows(collapsedOnRoute)).toEqual(["[a,b,c]", "  b"]);
    expect(fanoutRowThreads(collapsedOnRoute).map(keyOf)).toEqual(["b"]);
  });

  it("labels a group with the title of its first member", () => {
    const rows = arrange([
      thread("a", { fanoutGroupId: "send-1", title: "First title" }),
      thread("b", { fanoutGroupId: "send-1", title: "Renamed" }),
    ]);

    expect(rows[0]).toMatchObject({ kind: "group", group: { label: "First title" } });
  });
});
