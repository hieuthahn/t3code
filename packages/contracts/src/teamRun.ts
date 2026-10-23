import * as Schema from "effect/Schema";

import {
  NodeId,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { TeamLimits, TeamUsage } from "./team.ts";

/** Attempts one assignment key gets before the architect must give it up. */
export const TEAM_MAX_ATTEMPTS = 3;
/** A turn with no new events for this long is stopped, unless it waits on the user. */
export const TEAM_SILENCE_LIMIT_MS = 20 * 60 * 1_000;

export const TeamRunStatus = Schema.Literals([
  "running",
  "paused",
  "interrupted",
  "stopped",
  "finished",
]);
export type TeamRunStatus = typeof TeamRunStatus.Type;

export const TeamAssignmentStatus = Schema.Literals([
  "waiting",
  "running",
  "done",
  "failed",
  "cancelled",
]);
export type TeamAssignmentStatus = typeof TeamAssignmentStatus.Type;

export const TeamAssignmentKey = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export type TeamAssignmentKey = typeof TeamAssignmentKey.Type;

export const TeamAssignmentIsolation = Schema.Literals(["shared", "worktree"]);
export type TeamAssignmentIsolation = typeof TeamAssignmentIsolation.Type;

/** What a waiting assignment needs before it can start. */
export const TeamWaitReason = Schema.Union([
  Schema.TaggedStruct("dependency", { keys: Schema.Array(TeamAssignmentKey) }),
  Schema.TaggedStruct("dependency_failed", { keys: Schema.Array(TeamAssignmentKey) }),
  Schema.TaggedStruct("write_scope", {
    key: TeamAssignmentKey,
    files: Schema.Array(Schema.String),
  }),
  Schema.TaggedStruct("account_busy", { instanceId: ProviderInstanceId, running: PositiveInt }),
  Schema.TaggedStruct("team_parallel", { limit: PositiveInt }),
  Schema.TaggedStruct("team_paused", {}),
  Schema.TaggedStruct("next_turn", {}),
]);
export type TeamWaitReason = typeof TeamWaitReason.Type;

export const TeamAssignmentView = Schema.Struct({
  key: TeamAssignmentKey,
  title: Schema.String,
  providerInstanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  status: TeamAssignmentStatus,
  attempts: NonNegativeInt,
  dependsOn: Schema.Array(TeamAssignmentKey),
  readOnly: Schema.Boolean,
  /** Paths or folders it writes; empty means the whole checkout. */
  files: Schema.Array(Schema.String),
  isolation: TeamAssignmentIsolation,
  taskId: Schema.NullOr(NodeId),
  childThreadId: Schema.NullOr(ThreadId),
  waitReason: Schema.NullOr(TeamWaitReason),
  failure: Schema.NullOr(Schema.String),
  /** The worker's final report, cut to the team's report size. */
  result: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});
export type TeamAssignmentView = typeof TeamAssignmentView.Type;

export const TeamRunView = Schema.Struct({
  threadId: ThreadId,
  status: TeamRunStatus,
  limits: TeamLimits,
  usage: TeamUsage,
  stalls: NonNegativeInt,
  /** Why the team paused or stopped on its own, for the user. */
  report: Schema.NullOr(Schema.String),
  /** What the architect said the team achieved when it finished. */
  summary: Schema.NullOr(Schema.String),
  assignments: Schema.Array(TeamAssignmentView),
  updatedAt: Schema.String,
});
export type TeamRunView = typeof TeamRunView.Type;

export const TeamThreadInput = Schema.Struct({ threadId: ThreadId });
export type TeamThreadInput = typeof TeamThreadInput.Type;

export class TeamError extends Schema.TaggedError<TeamError>()("TeamError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}
