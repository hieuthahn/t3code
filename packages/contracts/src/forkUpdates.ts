import * as Schema from "effect/Schema";

export const DesktopForkUpdateTrackSchema = Schema.Literals(["preview", "stable", "nightly"]);
export type DesktopForkUpdateTrack = typeof DesktopForkUpdateTrackSchema.Type;

export const DesktopForkUpdateCheckSchema = Schema.Struct({
  checkedAt: Schema.String,
  head: Schema.String,
  upstreamHead: Schema.String,
  newCommits: Schema.Number,
  overlapFiles: Schema.Array(Schema.String),
  conflictFiles: Schema.Array(Schema.String),
  riskyFiles: Schema.Array(Schema.String),
  track: Schema.optionalKey(DesktopForkUpdateTrackSchema),
  baseTag: Schema.optionalKey(Schema.String),
  targetTag: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  updateAvailable: Schema.optionalKey(Schema.Boolean),
  droppedCommits: Schema.optionalKey(Schema.Number),
});
export type DesktopForkUpdateCheck = typeof DesktopForkUpdateCheckSchema.Type;

/** True when the newest tag of the track differs from the fork's base; older checks only count commits. */
export function isForkUpdateAvailable(check: DesktopForkUpdateCheck): boolean {
  return check.updateAvailable ?? check.newCommits > 0;
}

export const DesktopForkUpdateGateCheckSchema = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["pass", "warn", "block"]),
  summary: Schema.String,
  details: Schema.Array(Schema.String),
});

/** The report `t3-security-gate` writes for the upstream changes an update would bring. */
export const DesktopForkUpdateGateSchema = Schema.Struct({
  checkedAt: Schema.String,
  target: Schema.String,
  verdict: Schema.Literals(["pass", "warn", "block"]),
  checks: Schema.Array(DesktopForkUpdateGateCheckSchema),
});
export type DesktopForkUpdateGate = typeof DesktopForkUpdateGateSchema.Type;

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
  track: DesktopForkUpdateTrackSchema,
  paused: Schema.Boolean,
  activeRuns: Schema.Number,
  applyRunning: Schema.Boolean,
  check: Schema.NullOr(DesktopForkUpdateCheckSchema),
  lastRun: Schema.NullOr(DesktopForkUpdateRunSchema),
  gate: Schema.optionalKey(Schema.NullOr(DesktopForkUpdateGateSchema)),
  error: Schema.NullOr(Schema.String),
});
export type DesktopForkUpdateState = typeof DesktopForkUpdateStateSchema.Type;

export interface DesktopForkUpdatesBridge {
  getState: () => Promise<DesktopForkUpdateState>;
  check: () => Promise<DesktopForkUpdateState>;
  apply: () => Promise<DesktopForkUpdateState>;
  setPaused: (paused: boolean) => Promise<DesktopForkUpdateState>;
  setTrack: (track: DesktopForkUpdateTrack) => Promise<DesktopForkUpdateState>;
}
