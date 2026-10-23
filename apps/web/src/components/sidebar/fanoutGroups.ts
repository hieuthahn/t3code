import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

export type FanoutCandidate = Pick<
  EnvironmentThreadShell,
  "environmentId" | "projectId" | "title" | "createdAt" | "fanoutGroupId" | "lineage"
>;

/** Widest gap between the creation times of two threads one older multiple-models send started. */
export const FANOUT_GUESS_TOLERANCE_MS = 2_000;

const GUESSED_GROUP_PREFIX = "guess:";

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [item]);
    else group.push(item);
  }
  return groups;
}

/**
 * Map each thread key to the multiple-models send it came from.
 * A stored fanoutGroupId wins; root threads without one group by project, title and creation time.
 */
export function resolveFanoutGroupIds<T extends FanoutCandidate>(
  threads: readonly T[],
  keyOf: (thread: T) => string,
): ReadonlyMap<string, string> {
  const groupIdByKey = new Map<string, string>();
  const unstamped: { key: string; thread: T; createdMs: number }[] = [];
  for (const thread of threads) {
    if (thread.lineage.parentThreadId != null) continue;
    if (thread.fanoutGroupId) {
      groupIdByKey.set(keyOf(thread), `${thread.environmentId}:${thread.fanoutGroupId}`);
      continue;
    }
    const createdMs = Date.parse(thread.createdAt);
    if (Number.isFinite(createdMs)) unstamped.push({ key: keyOf(thread), thread, createdMs });
  }
  const buckets = groupBy(
    unstamped,
    ({ thread }) => `${thread.environmentId}\0${thread.projectId}\0${thread.title}`,
  );
  for (const bucket of buckets.values()) {
    const sorted = bucket.toSorted((left, right) => left.createdMs - right.createdMs);
    let anchor = sorted[0]!;
    let cluster: string[] = [];
    const flush = () => {
      if (cluster.length < 2) return;
      const groupId = `${GUESSED_GROUP_PREFIX}${anchor.key}`;
      for (const key of cluster) groupIdByKey.set(key, groupId);
    };
    for (const entry of sorted) {
      if (entry.createdMs - anchor.createdMs > FANOUT_GUESS_TOLERANCE_MS) {
        flush();
        anchor = entry;
        cluster = [];
      }
      cluster.push(entry.key);
    }
    flush();
  }
  return groupIdByKey;
}

export interface FanoutGroupHeader {
  readonly id: string;
  readonly label: string;
  readonly memberKeys: readonly string[];
  readonly collapsed: boolean;
}

export type FanoutRow<T> =
  | { readonly kind: "group"; readonly group: FanoutGroupHeader }
  | { readonly kind: "thread"; readonly thread: T; readonly nested: boolean };

/**
 * Lay out one section's threads, pulling each group's members up under a header at its first member.
 * A collapsed group keeps only the route thread visible; a group needs 2 members in the section.
 */
export function arrangeFanoutRows<T extends Pick<EnvironmentThreadShell, "title">>(input: {
  readonly threads: readonly T[];
  readonly keyOf: (thread: T) => string;
  readonly groupIdByKey: ReadonlyMap<string, string>;
  readonly collapsedGroupIds: ReadonlySet<string>;
  readonly routeThreadKey: string | null;
}): FanoutRow<T>[] {
  const { threads, keyOf, groupIdByKey, collapsedGroupIds, routeThreadKey } = input;
  const membersByGroupId = groupBy(
    threads.filter((thread) => groupIdByKey.has(keyOf(thread))),
    (thread) => groupIdByKey.get(keyOf(thread))!,
  );
  const rows: FanoutRow<T>[] = [];
  const placed = new Set<string>();
  for (const thread of threads) {
    const groupId = groupIdByKey.get(keyOf(thread));
    const members = groupId === undefined ? undefined : membersByGroupId.get(groupId);
    if (groupId === undefined || members === undefined || members.length < 2) {
      rows.push({ kind: "thread", thread, nested: false });
      continue;
    }
    if (placed.has(groupId)) continue;
    placed.add(groupId);
    const collapsed = collapsedGroupIds.has(groupId);
    rows.push({
      kind: "group",
      group: {
        id: groupId,
        label: members[0]!.title,
        memberKeys: members.map(keyOf),
        collapsed,
      },
    });
    for (const member of members) {
      if (collapsed && keyOf(member) !== routeThreadKey) continue;
      rows.push({ kind: "thread", thread: member, nested: true });
    }
  }
  return rows;
}

/** Return the threads a layout shows, in the order it shows them. */
export function fanoutRowThreads<T>(rows: readonly FanoutRow<T>[]): T[] {
  return rows.flatMap((row) => (row.kind === "thread" ? [row.thread] : []));
}
