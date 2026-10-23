import * as Schema from "effect/Schema";

import {
  MergeQueueItemId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { OrchestrationV2RuntimeRequestDecider } from "./orchestrationV2.ts";

export const MergeQueueItemStatus = Schema.Literals([
  "awaiting_user",
  "queued",
  "updating",
  "gating",
  "merging",
  "merged",
  "failed",
  "cancelled",
]);
export type MergeQueueItemStatus = typeof MergeQueueItemStatus.Type;

/** The step that stopped an item, so the child knows what to fix. */
export const MergeQueueFailureStage = Schema.Literals([
  "head_moved",
  "update",
  "gate",
  "merge",
  "interrupted",
]);
export type MergeQueueFailureStage = typeof MergeQueueFailureStage.Type;

export const MergeQueueGateRun = Schema.Struct({
  name: Schema.String,
  command: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
  durationMs: NonNegativeInt,
  /** The last few kilobytes of combined stdout and stderr. */
  outputTail: Schema.String,
});
export type MergeQueueGateRun = typeof MergeQueueGateRun.Type;

export const MergeQueueFailure = Schema.Struct({
  stage: MergeQueueFailureStage,
  message: Schema.String,
});
export type MergeQueueFailure = typeof MergeQueueFailure.Type;

export const MergeQueueItem = Schema.Struct({
  id: MergeQueueItemId,
  projectId: ProjectId,
  trunkRef: TrimmedNonEmptyString,
  ownerThreadId: ThreadId,
  childThreadId: ThreadId,
  childTitle: Schema.String,
  childBranch: TrimmedNonEmptyString,
  /** The child's head when it was queued; the user approves this commit and no other. */
  headShaAtEnqueue: TrimmedNonEmptyString,
  status: MergeQueueItemStatus,
  approvedBy: Schema.NullOr(OrchestrationV2RuntimeRequestDecider),
  gateRuns: Schema.Array(MergeQueueGateRun),
  mergedSha: Schema.NullOr(Schema.String),
  failure: Schema.NullOr(MergeQueueFailure),
  enqueuedAt: Schema.String,
  updatedAt: Schema.String,
});
export type MergeQueueItem = typeof MergeQueueItem.Type;

export const MergeQueueTrunk = Schema.Struct({
  trunkRef: TrimmedNonEmptyString,
  head: Schema.NullOr(Schema.String),
  /** The trunk moved since the queue last landed on it, so someone merged around the queue. */
  movedOutsideQueue: Schema.Boolean,
});
export type MergeQueueTrunk = typeof MergeQueueTrunk.Type;

export const MergeQueueView = Schema.Struct({
  ownerThreadId: ThreadId,
  trunks: Schema.Array(MergeQueueTrunk),
  items: Schema.Array(MergeQueueItem),
});
export type MergeQueueView = typeof MergeQueueView.Type;

export const MergeQueueSubscribeInput = Schema.Struct({ ownerThreadId: ThreadId });
export type MergeQueueSubscribeInput = typeof MergeQueueSubscribeInput.Type;

export const MergeQueueApproveInput = Schema.Struct({
  itemId: MergeQueueItemId,
  headSha: TrimmedNonEmptyString,
});
export type MergeQueueApproveInput = typeof MergeQueueApproveInput.Type;

export const MergeQueueCancelInput = Schema.Struct({ itemId: MergeQueueItemId });
export type MergeQueueCancelInput = typeof MergeQueueCancelInput.Type;

export class MergeQueueError extends Schema.TaggedError<MergeQueueError>()("MergeQueueError", {
  message: Schema.String,
  itemId: Schema.optional(MergeQueueItemId),
  cause: Schema.optional(Schema.Defect()),
}) {}
