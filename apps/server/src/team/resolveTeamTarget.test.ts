import { assert, it } from "@effect/vitest";
import { DEFAULT_TEAM_LIMITS, ProviderInstanceId, type TeamSetup } from "@t3tools/contracts";
import * as Result from "effect/Result";

import { resolveTeamTarget } from "./resolveTeamTarget.ts";

const codex = ProviderInstanceId.make("codex");
const codexWork = ProviderInstanceId.make("codex_work");
const team: TeamSetup = {
  architect: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-opus-4-1" },
  workers: [
    {
      instanceId: codex,
      model: "gpt-5-codex",
      options: [{ id: "reasoningEffort", value: "high" }],
    },
    { instanceId: codexWork, model: "gpt-5-codex-mini" },
  ],
  limits: { ...DEFAULT_TEAM_LIMITS, maxParallel: 3 },
};
it("leaves a thread outside a team with the target it asked for", () => {
  const target = { providerInstanceId: codex, model: "anything" };
  assert.deepEqual(resolveTeamTarget(undefined, target), Result.succeed(target));
});

it("sends a team's delegation to a worker with that worker's options", () => {
  assert.deepEqual(
    resolveTeamTarget(team, undefined),
    Result.succeed({
      providerInstanceId: codex,
      model: "gpt-5-codex",
      options: [{ id: "reasoningEffort", value: "high" }],
    }),
  );
  assert.deepEqual(
    resolveTeamTarget(team, {
      providerInstanceId: codexWork,
      options: [{ id: "reasoningEffort", value: "max" }],
    }),
    Result.succeed({ providerInstanceId: codexWork, model: "gpt-5-codex-mini", options: [] }),
  );
});

it("refuses a target outside the team and names the workers to pick from", () => {
  for (const target of [
    { providerInstanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-opus-4-1" },
    { providerInstanceId: codex, model: "gpt-5-codex-mini" },
    { driverKind: "codex" as never },
    { environmentId: "environment:laptop" as never },
  ]) {
    const result = resolveTeamTarget(team, target);
    assert.isTrue(Result.isFailure(result));
    if (Result.isFailure(result)) {
      assert.include(result.failure, "codex:gpt-5-codex, codex_work:gpt-5-codex-mini");
    }
  }
});
