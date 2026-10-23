import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  CommandId,
  MessageId,
  NodeId,
  type OrchestrationV2RuntimeRequestDecider,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
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
  openSession: () => Effect.die("No provider process needed for proposal cards"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "child-plan" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

const parentThreadId = ThreadId.make("thread:plan-parent");
const turnItemId = TurnItemId.make("turn-item:child-plan:parent:1");
const decidedBy = { actor: "user", authSessionId: AuthSessionId.make("session:web") } as const;
const proposal = (key: string, title: string) => ({
  key,
  title,
  brief: `Do the ${key} part`,
  isolation: "worktree" as const,
  modelSelection,
  runtimeMode: "auto-accept-edits" as const,
  interactionMode: "default" as const,
});

const startParent = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make("create-plan-parent"),
    threadId: parentThreadId,
    projectId: ProjectId.make("project:plan"),
    title: "Refactor retry",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  yield* orchestrator.dispatch({
    type: "message.dispatch",
    commandId: CommandId.make("start-plan-parent"),
    threadId: parentThreadId,
    messageId: MessageId.make("message:plan-parent"),
    text: "Split the retry work",
    attachments: [],
    dispatchMode: { type: "start_immediately" },
    createdBy: "user",
    creationSource: "web",
  });
  const run = (yield* projections.getThreadProjection(parentThreadId)).runs[0]!;
  const record = (
    id: string,
    planStatus: "pending" | "expired" | "cancelled",
    children = [proposal("api", "Retry sends"), proposal("ui", "Show retry state")],
  ) =>
    orchestrator.dispatch({
      type: "child_plan.record",
      commandId: CommandId.make(id),
      threadId: parentThreadId,
      runId: run.id,
      nodeId: run.rootNodeId!,
      turnItemId,
      planId: "child-plan:parent:1",
      reason: "Two independent halves",
      children,
      planStatus,
    });
  const decide = (
    id: string,
    revision: number,
    approvedKeys: ReadonlyArray<string>,
    decider: OrchestrationV2RuntimeRequestDecider = decidedBy,
  ) =>
    orchestrator.dispatch({
      type: "child_plan.decide",
      commandId: CommandId.make(id),
      threadId: parentThreadId,
      turnItemId,
      revision,
      approvedKeys,
      decidedBy: decider,
    });
  const card = Effect.map(projections.getThreadProjection(parentThreadId), (projection) => {
    const item = projection.turnItems.find((candidate) => candidate.id === turnItemId);
    assert.equal(item?.type, "child_plan_request");
    return item?.type === "child_plan_request" ? item : undefined;
  });
  return { orchestrator, projections, run, record, decide, card };
});

it.effect("records a proposal card and the user's decision on it", () =>
  Effect.gen(function* () {
    const { projections, record, decide, card } = yield* startParent;
    yield* record("plan-record-1", "pending");

    const pending = yield* card;
    assert.equal(pending?.status, "waiting");
    assert.equal(pending?.planStatus, "pending");
    assert.equal(pending?.revision, 1);
    assert.isNull(pending?.planDecision);
    assert.deepEqual(
      pending?.children.map((child) => child.key),
      ["api", "ui"],
    );
    const waitingShell = (yield* projections.getShellSnapshot()).threads.find(
      (thread) => thread.id === parentThreadId,
    );
    assert.equal(waitingShell?.pendingRuntimeRequest?.kind, "user_input");
    const projectionShell = ProjectionStore.threadShellFromProjection(
      yield* projections.getThreadProjection(parentThreadId),
    );
    assert.equal(projectionShell.pendingRuntimeRequest?.kind, "user_input");

    yield* decide("plan-decide-1", 1, ["api"]);
    const decided = yield* card;
    assert.equal(decided?.status, "completed");
    assert.equal(decided?.planStatus, "partially_approved");
    assert.deepEqual(decided?.planDecision?.approvedKeys, ["api"]);
    assert.deepEqual(decided?.planDecision?.declinedKeys, ["ui"]);
    assert.deepEqual(decided?.planDecision?.decidedBy, decidedBy);
    assert.equal(decided?.planDecision?.revision, 1);

    yield* record("plan-record-retry", "pending");
    assert.equal((yield* card)?.planStatus, "partially_approved");
    const settledShell = (yield* projections.getShellSnapshot()).threads.find(
      (thread) => thread.id === parentThreadId,
    );
    assert.isNull(settledShell?.pendingRuntimeRequest ?? null);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("rejects a decision by an agent, or on a changed, decided or unknown proposal", () =>
  Effect.gen(function* () {
    const { record, decide, card } = yield* startParent;
    yield* record("plan-record-1", "pending");
    yield* record("plan-record-2", "pending", [
      proposal("api", "Retry sends"),
      proposal("docs", "Document retry"),
    ]);
    assert.equal((yield* card)?.revision, 2);

    const byAgent = yield* decide("plan-decide-agent", 2, ["api"], {
      actor: "agent",
      threadId: parentThreadId,
    }).pipe(Effect.result);
    assert.isTrue(Result.isFailure(byAgent));
    const stale = yield* decide("plan-decide-stale", 1, ["api"]).pipe(Effect.result);
    assert.isTrue(Result.isFailure(stale));
    const unknown = yield* decide("plan-decide-unknown", 2, ["ui"]).pipe(Effect.result);
    assert.isTrue(Result.isFailure(unknown));
    assert.equal((yield* card)?.planStatus, "pending");

    yield* decide("plan-decide-all", 2, ["api", "docs"]);
    assert.equal((yield* card)?.planStatus, "approved");
    const twice = yield* decide("plan-decide-twice", 2, []).pipe(Effect.result);
    assert.isTrue(Result.isFailure(twice));
    assert.equal((yield* card)?.planStatus, "approved");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("records which children started once the user decided", () =>
  Effect.gen(function* () {
    const { orchestrator, record, decide, card } = yield* startParent;
    yield* record("plan-record-1", "pending");
    const early = yield* orchestrator
      .dispatch({
        type: "child_plan.launched",
        commandId: CommandId.make("plan-launched-early"),
        threadId: parentThreadId,
        turnItemId,
        launches: [{ key: "api", taskId: NodeId.make("node:api") }],
      })
      .pipe(Effect.result);
    assert.isTrue(Result.isFailure(early));

    yield* decide("plan-decide-1", 1, ["api", "ui"]);
    yield* orchestrator.dispatch({
      type: "child_plan.launched",
      commandId: CommandId.make("plan-launched"),
      threadId: parentThreadId,
      turnItemId,
      launches: [
        {
          key: "api",
          taskId: NodeId.make("node:api"),
          childThreadId: ThreadId.make("thread:api"),
        },
        { key: "ui", failure: "The parent run ended before ui started." },
      ],
    });
    const launched = yield* card;
    assert.equal(launched?.planStatus, "approved");
    assert.deepEqual(
      launched?.launches?.map((launch) => launch.key),
      ["api", "ui"],
    );
    assert.equal(launched?.launches?.[1]?.failure, "The parent run ended before ui started.");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("expires a proposal nobody answered", () =>
  Effect.gen(function* () {
    const { record, decide, card } = yield* startParent;
    yield* record("plan-record-1", "pending");
    yield* record("plan-record-expired", "expired");

    const expired = yield* card;
    assert.equal(expired?.planStatus, "expired");
    assert.equal(expired?.status, "cancelled");
    const late = yield* decide("plan-decide-late", 1, ["api"]).pipe(Effect.result);
    assert.isTrue(Result.isFailure(late));
  }).pipe(Effect.provide(layerTest)),
);
