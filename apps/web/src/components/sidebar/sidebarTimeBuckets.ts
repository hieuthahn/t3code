import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

export type SidebarTimeBucket = "today" | "week" | "older";

const BUCKET_ORDER: readonly SidebarTimeBucket[] = ["today", "week", "older"];

const BUCKET_LABELS: Record<SidebarTimeBucket, string> = {
  today: "Today",
  week: "This week",
  older: "Older",
};

const DAYS_IN_WEEK = 7;

export interface SidebarTimeBucketGroup<T> {
  readonly bucket: SidebarTimeBucket;
  readonly label: string;
  readonly items: readonly T[];
}

/** Place a moment in Today, This week (the six local days before today) or Older. */
export function sidebarTimeBucketOf(timeMs: number, nowMs: number): SidebarTimeBucket {
  if (!Number.isFinite(timeMs)) return "older";
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (timeMs >= startOfToday) return "today";
  const startOfWeek = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (DAYS_IN_WEEK - 1),
  ).getTime();
  return timeMs >= startOfWeek ? "week" : "older";
}

/** Split items into Today, This week and Older, keeping input order and dropping empty buckets. */
export function bucketByTime<T>(
  items: readonly T[],
  timeMsOf: (item: T) => number,
  nowMs: number,
): SidebarTimeBucketGroup<T>[] {
  const itemsByBucket = new Map<SidebarTimeBucket, T[]>();
  for (const item of items) {
    const bucket = sidebarTimeBucketOf(timeMsOf(item), nowMs);
    const bucketItems = itemsByBucket.get(bucket);
    if (bucketItems === undefined) itemsByBucket.set(bucket, [item]);
    else bucketItems.push(item);
  }
  return BUCKET_ORDER.flatMap((bucket) => {
    const bucketItems = itemsByBucket.get(bucket);
    return bucketItems === undefined
      ? []
      : [{ bucket, label: BUCKET_LABELS[bucket], items: bucketItems }];
  });
}

/** Return when a thread last took a prompt, or its last update when it never did. */
export function sidebarThreadTimeMs(
  thread: Pick<EnvironmentThreadShell, "latestUserMessageAt" | "updatedAt">,
): number {
  return Date.parse(thread.latestUserMessageAt ?? thread.updatedAt);
}

/** Order threads by their last prompt, newest first, so time buckets stay contiguous. */
export function sortThreadsByRecency<
  T extends Pick<EnvironmentThreadShell, "latestUserMessageAt" | "updatedAt"> & {
    readonly id: string;
  },
>(threads: readonly T[]): T[] {
  const timeMs = (thread: T) => {
    const value = sidebarThreadTimeMs(thread);
    return Number.isFinite(value) ? value : 0;
  };
  return threads.toSorted(
    (left, right) => timeMs(right) - timeMs(left) || left.id.localeCompare(right.id),
  );
}
