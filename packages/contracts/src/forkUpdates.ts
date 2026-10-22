import * as Schema from "effect/Schema";

export const DesktopForkUpdateCheckSchema = Schema.Struct({
  checkedAt: Schema.String,
  head: Schema.String,
  upstreamHead: Schema.String,
  newCommits: Schema.Number,
  overlapFiles: Schema.Array(Schema.String),
  conflictFiles: Schema.Array(Schema.String),
  riskyFiles: Schema.Array(Schema.String),
});
export type DesktopForkUpdateCheck = typeof DesktopForkUpdateCheckSchema.Type;

export const DesktopForkUpdateRunSchema = Schema.Struct({
  kind: Schema.String,
  startedAt: Schema.String,
  finishedAt: Schema.String,
  exitCode: Schema.Number,
  step: Schema.String,
  message: Schema.String,
  conflictFiles: Schema.Array(Schema.String),
  head: Schema.String,
});
export type DesktopForkUpdateRun = typeof DesktopForkUpdateRunSchema.Type;

/** What `t3-update status` reports; `enabled` is false when the app has no fork updater. */
export const DesktopForkUpdateStateSchema = Schema.Struct({
  enabled: Schema.Boolean,
  head: Schema.String,
  branch: Schema.String,
  paused: Schema.Boolean,
  activeRuns: Schema.Number,
  applyRunning: Schema.Boolean,
  check: Schema.NullOr(DesktopForkUpdateCheckSchema),
  lastRun: Schema.NullOr(DesktopForkUpdateRunSchema),
  error: Schema.NullOr(Schema.String),
});
export type DesktopForkUpdateState = typeof DesktopForkUpdateStateSchema.Type;

export interface DesktopForkUpdatesBridge {
  getState: () => Promise<DesktopForkUpdateState>;
  check: () => Promise<DesktopForkUpdateState>;
  apply: () => Promise<DesktopForkUpdateState>;
  setPaused: (paused: boolean) => Promise<DesktopForkUpdateState>;
}
