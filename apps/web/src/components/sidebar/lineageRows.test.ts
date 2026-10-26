import { describe, expect, it } from "vite-plus/test";

import type { FanoutRow } from "./fanoutGroups";
import {
  attachLineageRows,
  isNestedChildThread,
  type LineageCandidate,
  lineageGroupId,
  resolveLineageChildren,
} from "./lineageRows";

type TestThread = LineageCandidate & { readonly key: string };

const BASE_MS = Date.parse("2026-10-23T09:00:00.000Z");

function thread(
  key: string,
  overrides: {
    readonly parent?: string;
    readonly relationship?: "subagent" | "fork";
    readonly creationSource?: "mcp" | "provider" | "web";
    readonly createdOffsetMs?: number;
    readonly archived?: boolean;
    readonly environmentId?: string;
  } = {},
): TestThread {
  const parent = overrides.parent ?? null;
  return {
    key,
    id: key as TestThread["id"],
    environmentId: (overrides.environmentId ?? "env-1") as TestThread["environmentId"],
    createdAt: new Date(BASE_MS + (overrides.createdOffsetMs ?? 0)).toISOString(),
    archivedAt: overrides.archived === true ? new Date(BASE_MS).toISOString() : null,
    lineage: {
      parentThreadId: parent as TestThread["lineage"]["parentThreadId"],
      relationshipToParent: parent === null ? null : (overrides.relationship ?? "subagent"),
      rootThreadId: (parent ?? key) as TestThread["lineage"]["rootThreadId"],
    },
    source: { creationSource: overrides.creationSource ?? "mcp" },
  };
}

const keyOf = (candidate: Pick<TestThread, "environmentId" | "id">) =>
  `${candidate.environmentId}:${candidate.id}`;
const row = (candidate: TestThread, nested = false): FanoutRow<TestThread> => ({
  kind: "thread",
  thread: candidate,
  nested,
});
const describeChildren = (children: readonly TestThread[]) => `${children.length} children`;

describe("isNestedChildThread", () => {
  it("nests the subagents T3 started and leaves provider-native ones and forks out", () => {
    expect(isNestedChildThread(thread("api", { parent: "root" }))).toBe(true);
    expect(
      isNestedChildThread(thread("task", { parent: "root", creationSource: "provider" })),
    ).toBe(false);
    expect(isNestedChildThread(thread("fork", { parent: "root", relationship: "fork" }))).toBe(
      false,
    );
    expect(isNestedChildThread(thread("root"))).toBe(false);
  });
});

describe("resolveLineageChildren", () => {
  it("lists each parent's live child sessions oldest first", () => {
    const children = resolveLineageChildren(
      [
        thread("root"),
        thread("ui", { parent: "root", createdOffsetMs: 2_000 }),
        thread("api", { parent: "root", createdOffsetMs: 1_000 }),
        thread("task", { parent: "root", creationSource: "provider" }),
        thread("old", { parent: "root", archived: true }),
        thread("away", { parent: "root", environmentId: "env-2" }),
      ],
      keyOf,
    );

    expect(children.get("env-1:root")?.map((child) => child.key)).toEqual(["api", "ui"]);
    expect(children.get("env-2:root")?.map((child) => child.key)).toEqual(["away"]);
    expect(children.size).toBe(2);
  });
});

describe("attachLineageRows", () => {
  const root = thread("root");
  const api = thread("api", { parent: "root", createdOffsetMs: 1_000 });
  const ui = thread("ui", { parent: "root", createdOffsetMs: 2_000 });
  const apiTests = thread("api-tests", { parent: "api", createdOffsetMs: 3_000 });
  const other = thread("other");
  const childrenByParentKey = resolveLineageChildren([root, api, ui, apiTests, other], keyOf);

  it("puts a header and the child rows right under their parent", () => {
    const rows = attachLineageRows([row(root), row(other)], {
      childrenByParentKey,
      keyOf,
      collapsedGroupIds: new Set(),
      routeThreadKey: null,
      describeChildren,
    });

    expect(rows).toEqual([
      row(root),
      {
        kind: "group",
        group: {
          id: lineageGroupId("env-1:root"),
          label: "2 children",
          memberKeys: ["env-1:api", "env-1:ui"],
          collapsed: false,
          lineageParentKey: "env-1:root",
        },
      },
      row(api, true),
      {
        kind: "group",
        group: {
          id: lineageGroupId("env-1:api"),
          label: "1 children",
          memberKeys: ["env-1:api-tests"],
          collapsed: false,
          lineageParentKey: "env-1:api",
        },
      },
      row(apiTests, true),
      row(ui, true),
      row(other),
    ]);
  });

  it("keeps only the open child under a collapsed header", () => {
    const rows = attachLineageRows([row(root)], {
      childrenByParentKey,
      keyOf,
      collapsedGroupIds: new Set([lineageGroupId("env-1:root")]),
      routeThreadKey: "env-1:ui",
      describeChildren,
    });

    expect(
      rows.map((entry) => (entry.kind === "group" ? entry.group.id : entry.thread.key)),
    ).toEqual(["root", lineageGroupId("env-1:root"), "ui"]);
  });

  it("leaves a thread without children and a nested multi-model row untouched", () => {
    const rows = [row(other), row(thread("sibling"), true)];

    expect(
      attachLineageRows(rows, {
        childrenByParentKey,
        keyOf,
        collapsedGroupIds: new Set(),
        routeThreadKey: null,
        describeChildren,
      }),
    ).toEqual(rows);
  });

  it("stops at a lineage loop instead of repeating rows", () => {
    const loopA = thread("loop-a", { parent: "loop-b" });
    const loopB = thread("loop-b", { parent: "loop-a" });
    const rows = attachLineageRows([row(loopA)], {
      childrenByParentKey: resolveLineageChildren([loopA, loopB], keyOf),
      keyOf,
      collapsedGroupIds: new Set(),
      routeThreadKey: null,
      describeChildren,
    });

    expect(rows.filter((entry) => entry.kind === "thread")).toHaveLength(2);
  });
});

describe("attachLineageRows with a headerless parent", () => {
  it("rows the parent's children directly under it with no group header", () => {
    const lead = thread("lead");
    const worker = thread("worker", { parent: "lead" });
    const helper = thread("helper", { parent: "worker" });
    const childrenByParentKey = resolveLineageChildren([lead, worker, helper], keyOf);
    const rows = attachLineageRows([row(lead)], {
      childrenByParentKey,
      keyOf,
      collapsedGroupIds: new Set(),
      routeThreadKey: null,
      describeChildren,
      headerlessParentKeys: new Set([keyOf(lead)]),
    });
    expect(
      rows.map((entry) => (entry.kind === "group" ? entry.group.id : entry.thread.id)),
    ).toEqual(["lead", "worker", lineageGroupId(keyOf(worker)), "helper"]);
  });
});
