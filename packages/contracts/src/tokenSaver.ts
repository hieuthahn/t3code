import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { NonNegativeInt, ThreadId } from "./baseSchemas.ts";

export const TokenSaverConciseLevel = Schema.Literals(["off", "lite", "full", "ultra"]);
export type TokenSaverConciseLevel = typeof TokenSaverConciseLevel.Type;

export const TokenSaverConfig = Schema.Struct({
  concise: TokenSaverConciseLevel,
  leanCode: Schema.Boolean,
  quietTools: Schema.Boolean,
  rtk: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type TokenSaverConfig = typeof TokenSaverConfig.Type;

export const DEFAULT_TOKEN_SAVER_CONFIG: TokenSaverConfig = {
  concise: "lite",
  leanCode: false,
  quietTools: true,
  rtk: false,
};

export const TOKEN_SAVER_OFF_CONFIG: TokenSaverConfig = {
  concise: "off",
  leanCode: false,
  quietTools: false,
  rtk: false,
};

/** Below this many measured turns a side shows "not enough data" instead of an average. */
export const TOKEN_SAVER_MIN_SAMPLE_TURNS = 5;

export function isTokenSaverConfigActive(config: TokenSaverConfig): boolean {
  return config.concise !== "off" || config.leanCode || config.quietTools || config.rtk;
}

export type TokenSaverPack = "concise" | "leanCode" | "quietTools" | "rtk";

/** Rough share of a turn's tokens each pack saves; estimates, not measurements. */
const TOKEN_SAVER_ESTIMATED_SHARE = {
  concise: { off: 0, lite: 0.1, full: 0.2, ultra: 0.3 },
  leanCode: 0.1,
  quietTools: 0.15,
  rtk: 0.2,
} as const;

export function tokenSaverPackShare(config: TokenSaverConfig, pack: TokenSaverPack): number {
  if (pack === "concise") return TOKEN_SAVER_ESTIMATED_SHARE.concise[config.concise];
  return config[pack] ? TOKEN_SAVER_ESTIMATED_SHARE[pack] : 0;
}

/** Combined estimated saving in whole percent; savings compound, so shares multiply. */
export function estimateTokenSaverSavingPercent(
  config: TokenSaverConfig,
  tools: { readonly rtk: boolean },
): number {
  const packs: ReadonlyArray<TokenSaverPack> = ["concise", "leanCode", "quietTools", "rtk"];
  const kept = packs
    .filter((pack) => pack !== "rtk" || tools.rtk)
    .reduce((left, pack) => left * (1 - tokenSaverPackShare(config, pack)), 1);
  return Math.round((1 - kept) * 100);
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
  /** Whether the server host has rtk on its PATH, which the rtk pack needs. */
  rtkAvailable: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
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
