import {
  type EnvironmentThreadShell,
  threadRuntimeIsActive,
} from "@t3tools/client-runtime/state/models";

export type SidebarStatusBucket = "needs-input" | "working" | "completed";

const BUCKET_ORDER: readonly SidebarStatusBucket[] = ["needs-input", "working", "completed"];

const BUCKET_LABELS: Record<SidebarStatusBucket, string> = {
  "needs-input": "Needs input",
  working: "Working",
  completed: "Completed",
};

const STOPPED_RUN_STATUSES: ReadonlySet<string> = new Set(["failed", "interrupted", "cancelled"]);

export type SidebarStatusInput = Pick<
  EnvironmentThreadShell,
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "hasActionableProposedPlan"
  | "interactionMode"
  | "latestRun"
  | "runtime"
>;

export interface SidebarStatusBucketGroup<T> {
  readonly bucket: SidebarStatusBucket;
  readonly label: string;
  readonly items: readonly T[];
}

/**
 * Place a thread in Needs input, Working or Completed from its shell alone.
 * Failures count by run status, not the visited watermark, so opening a thread never regroups it.
 */
export function sidebarStatusBucketOf(thread: SidebarStatusInput): SidebarStatusBucket {
  if (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.pendingSubagentRequest != null
  ) {
    return "needs-input";
  }
  if (threadRuntimeIsActive(thread.runtime)) return "working";
  if (thread.interactionMode === "plan" && thread.hasActionableProposedPlan) return "needs-input";
  const runStatus = thread.runtime?.status ?? thread.latestRun?.status;
  return runStatus !== undefined && STOPPED_RUN_STATUSES.has(runStatus)
    ? "needs-input"
    : "completed";
}

/**
 * Split items into Needs input, Working and Completed, keeping input order and dropping empty buckets.
 * Items sharing a cohort, such as one multiple-models send, all land in their most urgent member's bucket.
 */
export function bucketByStatus<T>(
  items: readonly T[],
  bucketOf: (item: T) => SidebarStatusBucket,
  cohortOf: (item: T) => string | undefined,
): SidebarStatusBucketGroup<T>[] {
  const urgency = (bucket: SidebarStatusBucket) => BUCKET_ORDER.indexOf(bucket);
  const bucketByCohort = new Map<string, SidebarStatusBucket>();
  for (const item of items) {
    const cohort = cohortOf(item);
    if (cohort === undefined) continue;
    const bucket = bucketOf(item);
    const current = bucketByCohort.get(cohort);
    if (current === undefined || urgency(bucket) < urgency(current)) {
      bucketByCohort.set(cohort, bucket);
    }
  }
  const itemsByBucket = new Map<SidebarStatusBucket, T[]>();
  for (const item of items) {
    const cohort = cohortOf(item);
    const bucket =
      (cohort === undefined ? undefined : bucketByCohort.get(cohort)) ?? bucketOf(item);
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
