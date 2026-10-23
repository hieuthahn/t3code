import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  DEFAULT_TEAM_LIMITS,
  TeamSetup,
  teamLimitChangeProblems,
  type TeamLimits,
} from "./team.ts";

const decodeSetup = Schema.decodeUnknownResult(TeamSetup);
const decodeSetupEffect = Schema.decodeEffect(TeamSetup);
const encodeSetupEffect = Schema.encodeEffect(TeamSetup);

const member = (instanceId: string, model: string) => ({ instanceId, model });

const setup = (overrides: Record<string, unknown> = {}) => ({
  architect: member("claudeAgent", "claude-opus-4-1"),
  workers: [member("codex", "gpt-5-codex")],
  limits: DEFAULT_TEAM_LIMITS,
  ...overrides,
});

it("accepts one architect with one to six workers from different accounts", () => {
  const workers = Array.from({ length: 6 }, (_, index) => member(`codex_${index}`, "gpt-5-codex"));
  assert.isTrue(Result.isSuccess(decodeSetup(setup({ workers }))));
  assert.isTrue(Result.isFailure(decodeSetup(setup({ workers: [] }))));
  assert.isTrue(Result.isFailure(decodeSetup(setup({ workers: [...workers, workers[0]] }))));
});

it("bounds each run limit", () => {
  const withLimits = (limits: Partial<TeamLimits>) =>
    decodeSetup(setup({ limits: { ...DEFAULT_TEAM_LIMITS, ...limits } }));
  assert.isTrue(Result.isSuccess(withLimits({ maxRounds: 20, maxAssignments: 50 })));
  assert.isTrue(Result.isFailure(withLimits({ maxRounds: 0 })));
  assert.isTrue(Result.isFailure(withLimits({ maxRounds: 21 })));
  assert.isTrue(Result.isFailure(withLimits({ maxAssignments: 51 })));
  assert.isTrue(Result.isSuccess(withLimits({ maxParallel: "unlimited" })));
  assert.isTrue(Result.isSuccess(withLimits({ maxParallel: 3 })));
  assert.isTrue(Result.isFailure(withLimits({ maxParallel: 0 })));
  assert.isTrue(Result.isSuccess(withLimits({ summaryLimitBytes: 512 })));
  assert.isTrue(Result.isFailure(withLimits({ summaryLimitBytes: 511 })));
  assert.isTrue(Result.isFailure(withLimits({ summaryLimitBytes: 6001 })));
});

it("measures lead guidance in UTF-8 bytes, not characters", () => {
  assert.isTrue(Result.isSuccess(decodeSetup(setup({ leadGuidance: "a".repeat(1999) }))));
  assert.isTrue(Result.isFailure(decodeSetup(setup({ leadGuidance: "a".repeat(2000) }))));
  // 700 characters of three bytes each: short by length, over the limit in bytes.
  assert.isTrue(Result.isFailure(decodeSetup(setup({ leadGuidance: "ệ".repeat(700) }))));
});

it.effect("round-trips a setup with model options", () =>
  Effect.gen(function* () {
    const value = setup({
      architect: {
        ...member("claudeAgent", "claude-opus-4-1"),
        options: [{ id: "effort", value: "high" }],
      },
      leadGuidance: "Coordinate only; never edit files yourself.",
    });
    const decoded = yield* decodeSetupEffect(value);
    const encoded = yield* encodeSetupEffect(decoded);
    assert.deepEqual(yield* decodeSetupEffect(encoded), decoded);
  }),
);

it("refuses to lower a limit below what the team already used", () => {
  const used = { rounds: 5, assignments: 9 };
  assert.deepEqual(teamLimitChangeProblems({ ...DEFAULT_TEAM_LIMITS, maxRounds: 5 }, used), []);
  assert.deepEqual(
    teamLimitChangeProblems({ ...DEFAULT_TEAM_LIMITS, maxRounds: 4, maxAssignments: 8 }, used),
    [
      "maxRounds cannot go below the 5 rounds already used.",
      "maxAssignments cannot go below the 9 assignments already made.",
    ],
  );
});
