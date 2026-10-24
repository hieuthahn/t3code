import { assert, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_TEAM_LIMITS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2Command,
  type TeamSettings,
  type TeamSetup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.1-codex" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for team metadata"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const team: TeamSetup = {
  architect: modelSelection,
  workers: [{ instanceId: ProviderInstanceId.make("codex_work"), model: "gpt-5.1-codex" }],
  limits: DEFAULT_TEAM_LIMITS,
  leadGuidance: "Coordinate only.",
};

const layerWithTeamSettings = (settings: { readonly team?: Partial<TeamSettings> }) => {
  const layerDatabase = SqlitePersistence.layerMemory;
  return Layer.mergeAll(
    layerDatabase,
    ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
    EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
    ProviderReplayHarness.layerWithRegistry(
      { name: "team-metadata" },
      ProviderAdapterRegistry.layerFromAdapters([adapter]),
      { databaseLayer: layerDatabase, runEffectWorker: false, settings },
    ),
  );
};

const create = (
  threadId: ThreadId,
  overrides: Partial<Extract<OrchestrationV2Command, { type: "thread.create" }>> = {},
) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
    orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create-${threadId}`),
      threadId,
      projectId: ProjectId.make("project:team"),
      title: "Team thread",
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdBy: "user",
      creationSource: "web",
      ...overrides,
    }),
  );

const threadTeam = (threadId: ThreadId) =>
  Effect.flatMap(ProjectionStore.ProjectionStoreV2, (projections) =>
    Effect.all({
      thread: Effect.map(projections.getThreadProjection(threadId), ({ thread }) => thread.team),
      shell: Effect.map(projections.getThreadShell(threadId), (shell) => shell?.team),
    }),
  );

it.effect("runs a thread as a team and back to a single agent", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threadId = ThreadId.make("thread:team-toggle");
    yield* create(threadId);
    assert.deepEqual(yield* threadTeam(threadId), { thread: undefined, shell: undefined });

    yield* orchestrator.dispatch({
      type: "thread.metadata.update",
      commandId: CommandId.make("team-on"),
      threadId,
      team,
    });
    assert.deepEqual(yield* threadTeam(threadId), { thread: team, shell: team });

    yield* orchestrator.dispatch({
      type: "thread.metadata.update",
      commandId: CommandId.make("team-rename"),
      threadId,
      title: "Renamed",
    });
    assert.deepEqual((yield* threadTeam(threadId)).thread, team);

    yield* orchestrator.dispatch({
      type: "thread.metadata.update",
      commandId: CommandId.make("team-off"),
      threadId,
      team: null,
    });
    assert.deepEqual(yield* threadTeam(threadId), { thread: undefined, shell: undefined });
  }).pipe(Effect.provide(layerWithTeamSettings({}))),
);

it.effect("leaves new threads single-agent until the default setup is turned on for them", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("thread:team-default-off");
    yield* create(threadId);
    assert.isUndefined((yield* threadTeam(threadId)).thread);
  }).pipe(Effect.provide(layerWithTeamSettings({ team: { defaultSetup: team } }))),
);

it.effect("gives a new user thread its own copy of the default setup", () =>
  Effect.gen(function* () {
    const fresh = ThreadId.make("thread:team-default-on");
    yield* create(fresh);
    assert.deepEqual(yield* threadTeam(fresh), { thread: team, shell: team });

    const linked = ThreadId.make("thread:team-linked");
    yield* create(linked, { linkOrigin: { sessionId: "link-session", label: "Laptop" } });
    assert.isUndefined((yield* threadTeam(linked)).thread);

    const byAgent = ThreadId.make("thread:team-agent");
    yield* create(byAgent, { createdBy: "agent", creationSource: "mcp" });
    assert.isUndefined((yield* threadTeam(byAgent)).thread);
  }).pipe(
    Effect.provide(layerWithTeamSettings({ team: { defaultSetup: team, newThreads: true } })),
  ),
);
