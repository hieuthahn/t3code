import { RunAttemptId, ThreadId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TokenSaver from "./TokenSaverService.ts";

const THREAD = ThreadId.make("thread-token-saver");
const OTHER = ThreadId.make("thread-token-saver-other");

const layer = (enabled: boolean) =>
  TokenSaver.layer.pipe(
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provide(ServerSettings.layerTest({ tokenSaver: { enabled } })),
  );

const insertTurn = Effect.fn(function* (input: {
  readonly id: string;
  readonly threadId: ThreadId;
  readonly attemptId: string;
  readonly usage: object;
}) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO orchestration_v2_projection_provider_turns (
      provider_turn_id, thread_id, provider_thread_id, node_id, run_attempt_id,
      ordinal, status, started_at, completed_at, payload_json
    ) VALUES (
      ${input.id}, ${input.threadId}, ${`provider-${input.threadId}`}, ${`node-${input.id}`},
      ${input.attemptId}, ${Number(input.id.replace(/\D/g, ""))}, 'completed', NULL, NULL,
      ${JSON.stringify({ turnTokenUsage: input.usage })}
    )
  `;
});

const complete = (outputTokens: number, inputTokens = 1000) => ({
  usageScope: "main_agent",
  usageStatus: "complete",
  inputTokens,
  outputTokens,
  hasSubagents: false,
});

describe("TokenSaverService", () => {
  it.effect("follows the thread's override, else the defaults, only while enabled", () =>
    Effect.gen(function* () {
      const service = yield* TokenSaver.TokenSaverService;
      const fromDefaults = yield* service.resolveTurn({});
      assert.equal(fromDefaults.profileKey, "concise-lite+quiet-tools");
      assert.include(fromDefaults.instructions ?? "", "### Quiet tools");
      const overridden = yield* service.resolveTurn({
        tokenSaver: { concise: "ultra", leanCode: true, quietTools: false },
      });
      assert.equal(overridden.profileKey, "concise-ultra+lean-code");
      assert.notInclude(overridden.instructions ?? "", "### Quiet tools");
    }).pipe(Effect.provide(layer(true))),
  );

  it.effect("injects nothing while Token Saver is off in settings", () =>
    Effect.gen(function* () {
      const service = yield* TokenSaver.TokenSaverService;
      const turn = yield* service.resolveTurn({
        tokenSaver: { concise: "full", leanCode: true, quietTools: true },
      });
      assert.deepEqual(turn, { profileKey: "off", instructions: undefined });
    }).pipe(Effect.provide(layer(false))),
  );

  it.effect("compares complete turns tagged on with every other turn", () =>
    Effect.gen(function* () {
      const service = yield* TokenSaver.TokenSaverService;
      for (let index = 1; index <= 5; index++) {
        const attemptId = `attempt-on-${index}`;
        yield* service.recordAttempt({
          attemptId: RunAttemptId.make(attemptId),
          threadId: THREAD,
          profileKey: "concise-lite",
        });
        yield* insertTurn({
          id: `turn-${index}`,
          threadId: THREAD,
          attemptId,
          usage: complete(100),
        });
      }
      for (let index = 6; index <= 10; index++) {
        const attemptId = `attempt-off-${index}`;
        if (index % 2 === 0) {
          yield* service.recordAttempt({
            attemptId: RunAttemptId.make(attemptId),
            threadId: OTHER,
            profileKey: "off",
          });
        }
        yield* insertTurn({
          id: `turn-${index}`,
          threadId: OTHER,
          attemptId,
          usage: complete(300),
        });
      }
      yield* insertTurn({
        id: "turn-11",
        threadId: OTHER,
        attemptId: "attempt-partial",
        usage: { ...complete(9000), usageStatus: "partial" },
      });

      const stats = yield* service.stats(THREAD);
      assert.equal(stats.thread.on.turns, 5);
      assert.equal(stats.thread.on.averageOutputTokens, 100);
      assert.equal(stats.thread.off.turns, 0);
      assert.isNull(stats.thread.off.averageOutputTokens);
      assert.equal(stats.overall.off.turns, 5);
      assert.equal(stats.overall.off.averageOutputTokens, 300);
      assert.equal(stats.overall.on.averageInputTokens, 1000);
    }).pipe(Effect.provide(layer(true))),
  );
});
