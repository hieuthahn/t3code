import { describe, expect, it } from "vite-plus/test";

import { STANDALONE_GROUP_ID, groupByCoordinator } from "./coordinatorGroups";
import { type LineageCandidate, resolveLineageChildren } from "./lineageRows";

type TestThread = LineageCandidate & { readonly title: string };

const BASE_MS = Date.parse("2026-10-23T09:00:00.000Z");

function thread(
  id: string,
  overrides: {
    readonly parent?: string;
    readonly archived?: boolean;
    readonly order?: number;
  } = {},
): TestThread {
  const parent = overrides.parent ?? null;
  return {
    id: id as TestThread["id"],
    title: `Title ${id}`,
    environmentId: "env-1" as TestThread["environmentId"],
    createdAt: new Date(BASE_MS + (overrides.order ?? 0)).toISOString(),
    archivedAt: overrides.archived === true ? new Date(BASE_MS).toISOString() : null,
    lineage: {
      parentThreadId: parent as TestThread["lineage"]["parentThreadId"],
      relationshipToParent: parent === null ? null : "subagent",
      rootThreadId: (parent ?? id) as TestThread["lineage"]["rootThreadId"],
    },
    source: { creationSource: "mcp" },
  };
}

const keyOf = (candidate: Pick<TestThread, "environmentId" | "id">) =>
  `${candidate.environmentId}:${candidate.id}`;

function group(roots: readonly TestThread[], all: readonly TestThread[]) {
  return groupByCoordinator(roots, {
    keyOf,
    titleOf: (candidate) => candidate.title,
    childrenByParentKey: resolveLineageChildren(all, keyOf),
  });
}

describe("groupByCoordinator", () => {
  it("puts threads without children into one Standalone group", () => {
    const threads = [thread("a"), thread("b")];
    const groups = group(threads, threads);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: STANDALONE_GROUP_ID,
      label: "Standalone",
      coordinator: null,
      childCount: 2,
    });
    expect(groups[0]?.threads.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("makes each thread with children a group headed by that thread, Standalone last", () => {
    const all = [
      thread("lone"),
      thread("lead"),
      thread("w1", { parent: "lead", order: 1 }),
      thread("w2", { parent: "lead", order: 2 }),
    ];
    const groups = group([all[0]!, all[1]!], all);
    expect(groups.map((entry) => entry.id)).toEqual(["env-1:lead", STANDALONE_GROUP_ID]);
    expect(groups[0]).toMatchObject({ label: "Title lead", childCount: 2 });
    expect(groups[0]?.threads.map((entry) => entry.id)).toEqual(["lead", "w1", "w2"]);
  });

  it("keeps a two-level tree in the root's group, deepest threads after their parent", () => {
    const all = [
      thread("root"),
      thread("mid", { parent: "root", order: 1 }),
      thread("leaf", { parent: "mid", order: 2 }),
      thread("sibling", { parent: "root", order: 3 }),
    ];
    const groups = group([all[0]!], all);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.threads.map((entry) => entry.id)).toEqual(["root", "mid", "leaf", "sibling"]);
    expect(groups[0]?.childCount).toBe(3);
  });

  it("lists an orphan whose parent is archived as Standalone", () => {
    const all = [
      thread("gone", { archived: true }),
      thread("orphan", { parent: "gone", order: 1 }),
    ];
    const groups = group([all[1]!], all);
    expect(groups.map((entry) => entry.id)).toEqual([STANDALONE_GROUP_ID]);
    expect(groups[0]?.threads.map((entry) => entry.id)).toEqual(["orphan"]);
  });

  it("lets an orphan with its own children head a group", () => {
    const all = [
      thread("gone", { archived: true }),
      thread("orphan", { parent: "gone", order: 1 }),
      thread("kid", { parent: "orphan", order: 2 }),
    ];
    const groups = group([all[1]!], all);
    expect(groups.map((entry) => entry.id)).toEqual(["env-1:orphan"]);
    expect(groups[0]?.threads.map((entry) => entry.id)).toEqual(["orphan", "kid"]);
  });

  it("does not list a thread twice when a descendant also appears among the items", () => {
    const all = [thread("root"), thread("kid", { parent: "root", order: 1 })];
    const groups = group(all, all);
    expect(groups.map((entry) => entry.id)).toEqual(["env-1:root"]);
    expect(groups[0]?.threads.map((entry) => entry.id)).toEqual(["root", "kid"]);
  });

  it("returns nothing for an empty section", () => {
    expect(group([], [])).toEqual([]);
  });
});
