import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderOptionSelection } from "./model.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const TEAM_MAX_WORKERS = 6;
export const TEAM_MAX_PROFILES = 20;
/** Lead guidance must stay under this many UTF-8 bytes. */
export const TEAM_LEAD_GUIDANCE_MAX_BYTES = 2000;
/** Workers one provider account runs at once, whatever `maxParallel` allows. */
export const TEAM_PARALLEL_PER_ACCOUNT = 2;
export const TEAM_LIMIT_BOUNDS = {
  maxRounds: { minimum: 1, maximum: 20 },
  maxAssignments: { minimum: 1, maximum: 50 },
  summaryLimitBytes: { minimum: 512, maximum: 6000 },
} as const;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

const isUnderLeadGuidanceLimit = Schema.makeFilter(
  (value: string) => utf8ByteLength(value) < TEAM_LEAD_GUIDANCE_MAX_BYTES,
  { expected: `under ${TEAM_LEAD_GUIDANCE_MAX_BYTES} UTF-8 bytes` },
);

export const TeamMaxParallel = Schema.Union([Schema.Literal("unlimited"), PositiveInt]);
export type TeamMaxParallel = typeof TeamMaxParallel.Type;

export const TeamLimits = Schema.Struct({
  maxRounds: Schema.Int.check(Schema.isBetween(TEAM_LIMIT_BOUNDS.maxRounds)),
  maxAssignments: Schema.Int.check(Schema.isBetween(TEAM_LIMIT_BOUNDS.maxAssignments)),
  maxParallel: TeamMaxParallel,
  summaryLimitBytes: Schema.Int.check(Schema.isBetween(TEAM_LIMIT_BOUNDS.summaryLimitBytes)),
});
export type TeamLimits = typeof TeamLimits.Type;

export const DEFAULT_TEAM_LIMITS: TeamLimits = {
  maxRounds: 8,
  maxAssignments: 12,
  maxParallel: "unlimited",
  summaryLimitBytes: 2000,
};

/** A model choice on one provider account; it carries no legacy encodings to migrate. */
export const TeamMember = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(Schema.Array(ProviderOptionSelection)),
});
export type TeamMember = typeof TeamMember.Type;

/** The architect is the thread's own model; workers are the only models it may delegate to. */
export const TeamSetup = Schema.Struct({
  architect: TeamMember,
  workers: Schema.Array(TeamMember).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(TEAM_MAX_WORKERS),
  ),
  limits: TeamLimits,
  /** Workers start without the user's card, within the limits. Off unless the user turns it on. */
  autonomous: Schema.optionalKey(Schema.Boolean),
  /** Added after the built-in rules; it never replaces them. */
  leadGuidance: Schema.optionalKey(Schema.String.check(isUnderLeadGuidanceLimit)),
});
export type TeamSetup = typeof TeamSetup.Type;

export const TeamProfile = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  setup: TeamSetup,
});
export type TeamProfile = typeof TeamProfile.Type;

export const TeamUsage = Schema.Struct({
  rounds: NonNegativeInt,
  assignments: NonNegativeInt,
});
export type TeamUsage = typeof TeamUsage.Type;

/** Why `next` cannot replace a running team's limits; empty when it can. */
export function teamLimitChangeProblems(next: TeamLimits, used: TeamUsage): ReadonlyArray<string> {
  return [
    ...(next.maxRounds < used.rounds
      ? [`maxRounds cannot go below the ${used.rounds} rounds already used.`]
      : []),
    ...(next.maxAssignments < used.assignments
      ? [`maxAssignments cannot go below the ${used.assignments} assignments already made.`]
      : []),
  ];
}
