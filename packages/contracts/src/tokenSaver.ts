import * as Schema from "effect/Schema";

import { NonNegativeInt, ThreadId } from "./baseSchemas.ts";

export const TokenSaverConciseLevel = Schema.Literals(["off", "lite", "full", "ultra"]);
export type TokenSaverConciseLevel = typeof TokenSaverConciseLevel.Type;

export const TokenSaverConfig = Schema.Struct({
  concise: TokenSaverConciseLevel,
  leanCode: Schema.Boolean,
  quietTools: Schema.Boolean,
});
export type TokenSaverConfig = typeof TokenSaverConfig.Type;

export const DEFAULT_TOKEN_SAVER_CONFIG: TokenSaverConfig = {
  concise: "lite",
  leanCode: false,
  quietTools: true,
};

/** Below this many measured turns a side shows "not enough data" instead of an average. */
export const TOKEN_SAVER_MIN_SAMPLE_TURNS = 5;

export function isTokenSaverConfigActive(config: TokenSaverConfig): boolean {
  return config.concise !== "off" || config.leanCode || config.quietTools;
}

export const TokenSaverTurnSample = Schema.Struct({
  turns: NonNegativeInt,
  averageOutputTokens: Schema.NullOr(Schema.Number),
  averageInputTokens: Schema.NullOr(Schema.Number),
  averageCachedInputTokens: Schema.NullOr(Schema.Number),
});
export type TokenSaverTurnSample = typeof TokenSaverTurnSample.Type;

export const TokenSaverComparison = Schema.Struct({
  on: TokenSaverTurnSample,
  off: TokenSaverTurnSample,
});
export type TokenSaverComparison = typeof TokenSaverComparison.Type;

export const TokenSaverStatsInput = Schema.Struct({
  threadId: ThreadId,
});
export type TokenSaverStatsInput = typeof TokenSaverStatsInput.Type;

export const TokenSaverStats = Schema.Struct({
  thread: TokenSaverComparison,
  overall: TokenSaverComparison,
});
export type TokenSaverStats = typeof TokenSaverStats.Type;

export class TokenSaverStatsError extends Schema.TaggedError<TokenSaverStatsError>()(
  "TokenSaverStatsError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}
