import {
  type OrchestrationV2AppThread,
  type RunAttemptId,
  type ThreadId,
  type TokenSaverStats,
  TokenSaverStatsError,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { CommandAvailability } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerSettings from "../serverSettings.ts";
import {
  buildTokenSaverInstructions,
  effectiveTokenSaverConfig,
  tokenSaverProfileKey,
} from "./tokenSaverInstructions.ts";
import { summarizeTokenSaverUsage } from "./tokenSaverStats.ts";

export interface TokenSaverTurn {
  readonly profileKey: string;
  readonly instructions: string | undefined;
}

export class TokenSaverService extends Context.Service<
  TokenSaverService,
  {
    /** The rules a thread's next turn runs with; a settings read failure counts as off. */
    readonly resolveTurn: (
      thread: Pick<OrchestrationV2AppThread, "tokenSaver">,
    ) => Effect.Effect<TokenSaverTurn>;
    readonly recordAttempt: (input: {
      readonly attemptId: RunAttemptId;
      readonly threadId: ThreadId;
      readonly profileKey: string;
    }) => Effect.Effect<void>;
    readonly stats: (threadId: ThreadId) => Effect.Effect<TokenSaverStats, TokenSaverStatsError>;
  }
>()("t3/tokenSaver/TokenSaverService") {}

/** Drivers whose adapter puts the rules in a system prompt; other turns run, and count, as off. */
export const TOKEN_SAVER_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent", "codex"]);

const OFF: TokenSaverTurn = { profileKey: "off", instructions: undefined };

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const isCommandAvailable = yield* CommandAvailability;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rtkAvailable = isCommandAvailable("rtk").pipe(
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.provideService(Path.Path, path),
  );

  const resolveTurn = Effect.fn("TokenSaverService.resolveTurn")(function* (
    thread: Pick<OrchestrationV2AppThread, "tokenSaver">,
  ) {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Token Saver could not read settings.", { cause }).pipe(
          Effect.as(undefined),
        ),
      ),
    );
    if (settings === undefined) return OFF;
    const config = effectiveTokenSaverConfig(settings.tokenSaver, thread.tokenSaver, {
      rtk: yield* rtkAvailable,
    });
    return {
      profileKey: tokenSaverProfileKey(config),
      instructions: buildTokenSaverInstructions(config),
    };
  });

  const recordAttempt = Effect.fn("TokenSaverService.recordAttempt")(function* (input: {
    readonly attemptId: RunAttemptId;
    readonly threadId: ThreadId;
    readonly profileKey: string;
  }) {
    const recordedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      INSERT INTO token_saver_attempts (attempt_id, thread_id, profile_key, recorded_at)
      VALUES (${input.attemptId}, ${input.threadId}, ${input.profileKey}, ${recordedAt})
      ON CONFLICT (attempt_id) DO UPDATE SET profile_key = excluded.profile_key
    `.pipe(
      Effect.catch((cause) => Effect.logWarning("Token Saver could not tag a turn.", { cause })),
    );
  });

  const stats = Effect.fn("TokenSaverService.stats")(function* (threadId: ThreadId) {
    // Turns from before this table existed have no tag and count as off, which they were.
    const rows = yield* sql<{
      readonly saver_on: number;
      readonly in_thread: number;
      readonly turns: number;
      readonly output_tokens: number | null;
      readonly input_tokens: number | null;
      readonly cached_turns: number;
      readonly cached_input_tokens: number | null;
    }>`
      SELECT
        CASE WHEN tag.profile_key IS NOT NULL AND tag.profile_key <> 'off' THEN 1 ELSE 0 END AS saver_on,
        CASE WHEN turn.thread_id = ${threadId} THEN 1 ELSE 0 END AS in_thread,
        COUNT(*) AS turns,
        SUM(json_extract(turn.payload_json, '$.turnTokenUsage.outputTokens')) AS output_tokens,
        SUM(json_extract(turn.payload_json, '$.turnTokenUsage.inputTokens')) AS input_tokens,
        COUNT(json_extract(turn.payload_json, '$.turnTokenUsage.cachedInputTokens')) AS cached_turns,
        SUM(json_extract(turn.payload_json, '$.turnTokenUsage.cachedInputTokens')) AS cached_input_tokens
      FROM orchestration_v2_projection_provider_turns AS turn
      LEFT JOIN token_saver_attempts AS tag ON tag.attempt_id = turn.run_attempt_id
      WHERE json_extract(turn.payload_json, '$.turnTokenUsage.usageStatus') = 'complete'
      GROUP BY saver_on, in_thread
    `.pipe(
      NodeSqliteClient.readOnly,
      Effect.mapError(
        (cause) =>
          new TokenSaverStatsError({ detail: `Could not read token usage: ${String(cause)}` }),
      ),
    );
    const summary = summarizeTokenSaverUsage(
      rows.map((row) => ({
        saverOn: row.saver_on === 1,
        inThread: row.in_thread === 1,
        turns: row.turns,
        outputTokens: row.output_tokens ?? 0,
        inputTokens: row.input_tokens ?? 0,
        cachedTurns: row.cached_turns,
        cachedInputTokens: row.cached_input_tokens ?? 0,
      })),
    );
    return { ...summary, rtkAvailable: yield* rtkAvailable };
  });

  return TokenSaverService.of({ resolveTurn, recordAttempt, stats });
});

export const layer = Layer.effect(TokenSaverService, make);
