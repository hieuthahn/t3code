import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isProviderNativeSubagentThread } from "@t3tools/contracts";

import type { FanoutRow } from "./fanoutGroups";

export type LineageCandidate = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "createdAt" | "archivedAt" | "lineage"
> & { readonly source: Pick<EnvironmentThreadShell["source"], "creationSource"> };

type ThreadRef = Pick<EnvironmentThreadShell, "environmentId" | "id">;

const LINEAGE_GROUP_PREFIX = "lineage:";

export function lineageGroupId(parentKey: string): string {
  return `${LINEAGE_GROUP_PREFIX}${parentKey}`;
}

/** Whether a thread rows under its parent: a subagent T3 started, never one the provider owns. */
export function isNestedChildThread(thread: Pick<LineageCandidate, "lineage" | "source">): boolean {
  return (
    thread.lineage.relationshipToParent === "subagent" &&
    !isProviderNativeSubagentThread({
      lineage: thread.lineage,
      creationSource: thread.source.creationSource,
    })
  );
}

/** Map each parent's key to its unarchived child sessions, oldest first. */
export function resolveLineageChildren<T extends LineageCandidate>(
  threads: readonly T[],
  keyOf: (thread: ThreadRef) => string,
): ReadonlyMap<string, readonly T[]> {
  const childrenByParentKey = new Map<string, T[]>();
  for (const thread of threads) {
    const parentThreadId = thread.lineage.parentThreadId;
    if (parentThreadId === null || thread.archivedAt !== null || !isNestedChildThread(thread)) {
      continue;
    }
    const parentKey = keyOf({ environmentId: thread.environmentId, id: parentThreadId });
    const children = childrenByParentKey.get(parentKey);
    if (children === undefined) childrenByParentKey.set(parentKey, [thread]);
    else children.push(thread);
  }
  for (const children of childrenByParentKey.values()) {
    children.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  }
  return childrenByParentKey;
}

/**
 * Put each listed parent's child sessions right under its row, behind a collapsible header.
 * A collapsed header keeps only the route child visible.
 */
export function attachLineageRows<T extends ThreadRef>(
  rows: readonly FanoutRow<T>[],
  input: {
    readonly childrenByParentKey: ReadonlyMap<string, readonly T[]>;
    readonly keyOf: (thread: ThreadRef) => string;
    readonly collapsedGroupIds: ReadonlySet<string>;
    readonly routeThreadKey: string | null;
    readonly describeChildren: (children: readonly T[]) => string;
  },
): FanoutRow<T>[] {
  const { childrenByParentKey, keyOf, collapsedGroupIds, routeThreadKey, describeChildren } = input;
  if (childrenByParentKey.size === 0) return [...rows];
  const placed = new Set<string>();
  const result: FanoutRow<T>[] = [];
  const pushWithChildren = (row: FanoutRow<T>) => {
    result.push(row);
    if (row.kind !== "thread") return;
    const parentKey = keyOf(row.thread);
    placed.add(parentKey);
    const children = (childrenByParentKey.get(parentKey) ?? []).filter(
      (child) => !placed.has(keyOf(child)),
    );
    if (children.length === 0) return;
    const id = lineageGroupId(parentKey);
    const collapsed = collapsedGroupIds.has(id);
    result.push({
      kind: "group",
      group: {
        id,
        label: describeChildren(children),
        memberKeys: children.map(keyOf),
        collapsed,
        lineageParentKey: parentKey,
      },
    });
    for (const child of children) {
      if (collapsed && keyOf(child) !== routeThreadKey) continue;
      pushWithChildren({ kind: "thread", thread: child, nested: true });
    }
  };
  for (const row of rows) pushWithChildren(row);
  return result;
}
