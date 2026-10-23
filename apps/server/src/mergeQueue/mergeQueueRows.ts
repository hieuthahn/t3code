import {
  MergeQueueFailure,
  MergeQueueGateRun,
  MergeQueueItemId,
  MergeQueueItemStatus,
  OrchestrationV2RuntimeRequestDecider,
  ProjectId,
  ThreadId,
  type MergeQueueItem,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const OUTPUT_TAIL_BYTES = 8_000;
export const ACTIVE_STATUSES = [
  "awaiting_user",
  "queued",
  "updating",
  "gating",
  "merging",
] as const;
export const RUNNING_STATUSES = ["updating", "gating", "merging"] as const;

const MergeQueueRow = Schema.Struct({
  item_id: MergeQueueItemId,
  project_id: ProjectId,
  trunk_ref: Schema.String,
  owner_thread_id: ThreadId,
  owner_checkout: Schema.String,
  child_thread_id: ThreadId,
  child_title: Schema.String,
  child_branch: Schema.String,
  child_worktree: Schema.String,
  head_sha_at_enqueue: Schema.String,
  status: MergeQueueItemStatus,
  approved_by_json: Schema.NullOr(Schema.fromJsonString(OrchestrationV2RuntimeRequestDecider)),
  gate_runs_json: Schema.fromJsonString(Schema.Array(MergeQueueGateRun)),
  trunk_head_before: Schema.NullOr(Schema.String),
  merged_sha: Schema.NullOr(Schema.String),
  failure_json: Schema.NullOr(Schema.fromJsonString(MergeQueueFailure)),
  enqueued_at: Schema.String,
  updated_at: Schema.String,
});
export type MergeQueueRow = typeof MergeQueueRow.Type;
export const decodeRows = Schema.decodeUnknownEffect(Schema.Array(MergeQueueRow));
export const encodeGateRuns = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(MergeQueueGateRun)),
);
export const encodeFailure = Schema.encodeSync(Schema.fromJsonString(MergeQueueFailure));
export const encodeDecider = Schema.encodeSync(
  Schema.fromJsonString(OrchestrationV2RuntimeRequestDecider),
);

export const itemFromRow = (row: MergeQueueRow): MergeQueueItem => ({
  id: row.item_id,
  projectId: row.project_id,
  trunkRef: row.trunk_ref,
  ownerThreadId: row.owner_thread_id,
  childThreadId: row.child_thread_id,
  childTitle: row.child_title,
  childBranch: row.child_branch,
  headShaAtEnqueue: row.head_sha_at_enqueue,
  status: row.status,
  approvedBy: row.approved_by_json,
  gateRuns: row.gate_runs_json,
  mergedSha: row.merged_sha,
  failure: row.failure_json,
  enqueuedAt: row.enqueued_at,
  updatedAt: row.updated_at,
});

export const tail = (text: string) =>
  text.length <= OUTPUT_TAIL_BYTES ? text : text.slice(text.length - OUTPUT_TAIL_BYTES);
