import {
  EnvironmentId,
  NodeId,
  ProviderInstanceId,
  ProviderOptionSelection,
  TeamAssignmentIsolation,
  TeamAssignmentStatus,
  TeamRunStatus,
  ThreadId,
  utf8ByteLength,
  type TeamAssignmentView,
  type TeamRunView,
  type TeamSetup,
  type TeamWaitReason,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { McpInvocationScope } from "../mcp/McpInvocationContext.ts";
import type { ScheduledAssignment } from "./teamScheduler.ts";

/** The architect's MCP caller, kept so queued work starts later as the architect's own. */
const StoredCallerScope = Schema.Struct({
  environmentId: EnvironmentId,
  capabilities: Schema.Array(
    Schema.Literals(["preview", "orchestration", "worktree", "device", "pull-requests"]),
  ),
  issuedAt: Schema.Number,
  requestNamespace: Schema.String,
  thread: Schema.Struct({
    threadId: ThreadId,
    providerSessionId: Schema.String,
    providerInstanceId: ProviderInstanceId,
  }),
});
type StoredCallerScope = typeof StoredCallerScope.Type;

const TeamRunRow = Schema.Struct({
  run_id: Schema.String,
  thread_id: ThreadId,
  status: TeamRunStatus,
  rounds: Schema.Number,
  stalls: Schema.Number,
  last_stall_run_id: Schema.NullOr(Schema.String),
  caller_scope_json: Schema.fromJsonString(StoredCallerScope),
  report: Schema.NullOr(Schema.String),
  summary: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
});
export type TeamRunRow = typeof TeamRunRow.Type;

const TeamAssignmentRow = Schema.Struct({
  run_id: Schema.String,
  assignment_key: Schema.String,
  ordinal: Schema.Number,
  title: Schema.String,
  task: Schema.String,
  instance_id: ProviderInstanceId,
  model: Schema.String,
  options_json: Schema.fromJsonString(Schema.Array(ProviderOptionSelection)),
  depends_on_json: Schema.fromJsonString(Schema.Array(Schema.String)),
  read_only: Schema.Number,
  files_json: Schema.fromJsonString(Schema.Array(Schema.String)),
  isolation: TeamAssignmentIsolation,
  status: TeamAssignmentStatus,
  attempts: Schema.Number,
  task_id: Schema.NullOr(NodeId),
  child_thread_id: Schema.NullOr(ThreadId),
  failure: Schema.NullOr(Schema.String),
  result: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
});
export type TeamAssignmentRow = typeof TeamAssignmentRow.Type;

export const decodeRunRows = Schema.decodeUnknownEffect(Schema.Array(TeamRunRow));
export const decodeAssignmentRows = Schema.decodeUnknownEffect(Schema.Array(TeamAssignmentRow));
export const encodeCallerScope = Schema.encodeSync(Schema.fromJsonString(StoredCallerScope));
export const encodeOptions = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(ProviderOptionSelection)),
);
export const encodeStrings = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

export const storedCallerScope = (
  scope: McpInvocationScope & { readonly thread: NonNullable<McpInvocationScope["thread"]> },
): StoredCallerScope => ({
  environmentId: scope.environmentId,
  capabilities: [...scope.capabilities],
  issuedAt: scope.issuedAt,
  requestNamespace: scope.requestNamespace,
  thread: scope.thread,
});

export const callerScopeOf = (run: TeamRunRow): McpInvocationScope => ({
  ...run.caller_scope_json,
  capabilities: new Set(run.caller_scope_json.capabilities),
  client: undefined,
});

export const scheduledFrom = (row: TeamAssignmentRow): ScheduledAssignment => ({
  key: row.assignment_key,
  status: row.status,
  attempts: row.attempts,
  instanceId: row.instance_id,
  dependsOn: row.depends_on_json,
  readOnly: row.read_only === 1,
  files: row.files_json,
  isolation: row.isolation,
});

/** Cut a worker's report to the team's byte limit, on a character boundary. */
export function clipToBytes(text: string, limit: number): string {
  if (utf8ByteLength(text) <= limit) return text;
  let clipped = "";
  for (const character of text) {
    if (utf8ByteLength(`${clipped}${character}…`) > limit) break;
    clipped += character;
  }
  return `${clipped}…`;
}

export const assignmentView = (
  row: TeamAssignmentRow,
  waitReason: TeamWaitReason | undefined,
  summaryLimitBytes: number,
): TeamAssignmentView => ({
  key: row.assignment_key,
  title: row.title,
  providerInstanceId: row.instance_id,
  model: row.model,
  status: row.status,
  attempts: row.attempts,
  dependsOn: row.depends_on_json,
  readOnly: row.read_only === 1,
  files: row.files_json,
  isolation: row.isolation,
  taskId: row.task_id,
  childThreadId: row.child_thread_id,
  waitReason: waitReason ?? null,
  failure: row.failure,
  result: row.result === null ? null : clipToBytes(row.result, summaryLimitBytes),
  updatedAt: row.updated_at,
});

export const runView = (input: {
  readonly run: TeamRunRow;
  readonly team: TeamSetup;
  readonly assignments: ReadonlyArray<TeamAssignmentView>;
}): TeamRunView => ({
  threadId: input.run.thread_id,
  status: input.run.status,
  limits: input.team.limits,
  usage: { rounds: input.run.rounds, assignments: input.assignments.length },
  stalls: input.run.stalls,
  report: input.run.report,
  summary: input.run.summary,
  assignments: input.assignments,
  updatedAt: input.run.updated_at,
});
