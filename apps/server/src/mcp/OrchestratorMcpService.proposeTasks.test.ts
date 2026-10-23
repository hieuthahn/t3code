import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  EnvironmentId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as RemoteDelegation from "../peer/RemoteDelegation.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

const parentThreadId = ThreadId.make("thread:propose-parent");
const parentRunId = RunId.make("run:propose-parent");
const parentNodeId = NodeId.make("node:propose-root");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.4" };

const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:propose"),
  requestNamespace: "provider-session:propose",
  thread: {
    threadId: parentThreadId,
    providerSessionId: "provider-session:propose",
    providerInstanceId: instanceId,
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "test",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-23T00:00:00.000Z",
  models: [{ slug: "gpt-5.4", name: "gpt-5.4", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
};

const taskFor = (key: string) => ({
  id: NodeId.make(`node:task-${key}`),
  threadId: parentThreadId,
  runId: parentRunId,
  parentNodeId,
  origin: "app_owned",
  createdBy: "agent",
  driver: ProviderDriverKind.make("codex"),
  providerInstanceId: instanceId,
  providerThreadId: null,
  childThreadId: ThreadId.make(`thread:child-${key}`),
  nativeTaskRef: null,
  prompt: `Do the ${key} part`,
  title: key,
  model: "gpt-5.4",
  status: "running",
  result: null,
  startedAt: null,
  completedAt: null,
});

const proposal = {
  reason: "The server and the composer change apart.",
  tasks: [
    { key: "api", title: "Retry sends", task: "Do the api part" },
    { key: "ui", title: "Show retry state", task: "Do the ui part" },
  ],
};

function makeLayer(input: {
  readonly runStatus?: "running" | "completed";
  readonly parentRuntimeMode?: "full-access" | "auto-accept-edits";
  /** The keys the user approves as soon as the card shows; undefined never answers. */
  readonly approve?: ReadonlyArray<string>;
  readonly dispatched: Array<OrchestrationV2ServerCommand>;
}) {
  let card: Extract<OrchestrationV2TurnItem, { readonly type: "child_plan_request" }> | undefined;
  const started: Array<ReturnType<typeof taskFor>> = [];
  const projection = (threadId: ThreadId) =>
    ({
      thread: {
        id: threadId,
        projectId: ProjectId.make("project:propose"),
        title: "Refactor retry",
        createdBy: "user",
        creationSource: "web",
        modelSelection,
        runtimeMode: input.parentRuntimeMode ?? "full-access",
        interactionMode: "default",
        worktreePath: null,
      },
      runs:
        threadId === parentThreadId
          ? [
              {
                id: parentRunId,
                ordinal: 1,
                status: input.runStatus ?? "running",
                rootNodeId: parentNodeId,
                providerInstanceId: instanceId,
                modelSelection,
              },
            ]
          : [],
      contextTransfers: [],
      messages: [],
      providerThreads: [],
      runtimeRequests: [],
      subagents: threadId === parentThreadId ? started : [],
      turnItems: threadId === parentThreadId && card !== undefined ? [card] : [],
    }) as unknown as OrchestrationV2ThreadProjection;
  const dependencies = Layer.mergeAll(
    NodeServices.layer,
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      hasReceipt: (commandId) =>
        Effect.succeed(input.dispatched.some((command) => command.commandId === commandId)),
      isProviderInstanceEnabledForProject: () => Effect.succeed(true),
      assertProviderInstanceEnabled: () => Effect.void,
      getThreadRecords: (threadId) => Effect.succeed(projection(threadId)),
      dispatch: (command) =>
        Effect.sync(() => {
          input.dispatched.push(command);
          if (command.type === "child_plan.record") {
            if (card === undefined || command.planStatus !== "pending") {
              card = {
                id: command.turnItemId,
                type: "child_plan_request",
                runId: command.runId,
                planId: command.planId,
                revision: 1,
                planStatus: command.planStatus,
                children: command.children,
                planDecision: null,
              } as never;
            }
            if (input.approve !== undefined && card?.planStatus === "pending") {
              const keys = command.children.map((child) => child.key);
              card = {
                ...card,
                planStatus: "partially_approved",
                planDecision: {
                  decidedBy: { actor: "user", authSessionId: AuthSessionId.make("session:web") },
                  revision: 1,
                  approvedKeys: keys.filter((key) => input.approve!.includes(key)),
                  declinedKeys: keys.filter((key) => !input.approve!.includes(key)),
                },
              };
            }
            return {} as never;
          }
          if (command.type === "delegated_task.request") {
            const key = command.title === "Retry sends" ? "api" : "ui";
            const task = taskFor(key);
            if (!started.some((candidate) => candidate.id === task.id)) started.push(task);
            return {
              sequence: 1,
              storedEvents: [
                {
                  sequence: 1,
                  commandId: null,
                  event: { type: "subagent.updated", payload: task },
                },
              ],
            } as never;
          }
          return {} as never;
        }),
    }),
    Layer.mock(ProviderRegistry.ProviderRegistry)({
      getProviders: Effect.succeed([provider]),
      refreshInstance: () => Effect.succeed([provider]),
    }),
    Layer.succeed(
      ProviderAdapterRegistry.ProviderAdapterRegistryV2,
      ProviderAdapterRegistry.ProviderAdapterRegistryV2.of({
        list: () => Effect.succeed([instanceId]),
        get: () =>
          Effect.succeed({ instanceId } as unknown as ProviderAdapter.ProviderAdapterV2["Service"]),
      }),
    ),
    Layer.mock(ProjectService.ProjectService)({ getById: () => Effect.succeed(Option.none()) }),
    Layer.mock(SecretRequests.SecretRequests)({}),
    Layer.mock(RemoteDelegation.RemoteDelegation)({}),
    Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
    Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
    Layer.mock(GitVcsDriver.GitVcsDriver)({}),
    ServerSettings.layerTest(),
  );
  return OrchestratorMcpService.layer.pipe(Layer.provide(dependencies));
}

const propose = (
  input: Parameters<OrchestratorMcpService.OrchestratorMcpServiceShape["proposeTasks"]>[1],
) =>
  Effect.gen(function* () {
    const service = yield* OrchestratorMcpService.OrchestratorMcpService;
    return yield* service.proposeTasks(scope, input);
  });

it.effect("starts only the child sessions the user approved", () =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    const result = yield* propose({ ...proposal, clientRequestId: "plan-1" }).pipe(
      Effect.provide(makeLayer({ approve: ["api"], dispatched })),
    );

    assert.equal(result.status, "partially_approved");
    assert.deepEqual(result.declinedKeys, ["ui"]);
    assert.deepEqual(
      result.started.map((entry) => [entry.key, entry.childThreadId]),
      [["api", "thread:child-api"]],
    );
    const record = dispatched.find((command) => command.type === "child_plan.record");
    assert.equal(
      record?.type === "child_plan.record" ? record.children[0]?.modelSelection.model : null,
      "gpt-5.4",
    );
    const delegations = dispatched.filter((command) => command.type === "delegated_task.request");
    assert.lengthOf(delegations, 1);
    const launched = dispatched.find((command) => command.type === "child_plan.launched");
    assert.deepEqual(
      launched?.type === "child_plan.launched" ? launched.launches.map((launch) => launch.key) : [],
      ["api"],
    );
  }),
);

it.effect("starts each approved child once when the call is retried", () =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    const layer = makeLayer({ approve: ["api", "ui"], dispatched });
    yield* Effect.gen(function* () {
      yield* propose({ ...proposal, clientRequestId: "plan-retry" });
      yield* propose({ ...proposal, clientRequestId: "plan-retry" });
    }).pipe(Effect.provide(layer));

    const ids = dispatched
      .filter((command) => command.type === "delegated_task.request")
      .map((command) => command.commandId);
    assert.lengthOf(ids, 4);
    assert.deepEqual(ids.slice(2), ids.slice(0, 2));
    assert.lengthOf(new Set(ids), 2);
  }),
);

it.effect("refuses a proposal before any card shows when it cannot start as asked", () =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    const refuse = (
      input: Parameters<OrchestratorMcpService.OrchestratorMcpServiceShape["proposeTasks"]>[1],
      layerInput: Partial<Parameters<typeof makeLayer>[0]> = {},
    ) =>
      propose(input).pipe(
        Effect.flip,
        Effect.provide(makeLayer({ approve: ["api"], dispatched, ...layerInput })),
      );

    const finished = yield* refuse(proposal, { runStatus: "completed" });
    assert.equal(finished.code, "parent_not_active");
    const duplicate = yield* refuse({
      ...proposal,
      tasks: [proposal.tasks[0]!, { ...proposal.tasks[1]!, key: "api" }],
    });
    assert.equal(duplicate.code, "invalid_request");
    const remote = yield* refuse({
      ...proposal,
      tasks: [{ ...proposal.tasks[0]!, target: { environmentId: EnvironmentId.make("env:far") } }],
    });
    assert.equal(remote.code, "invalid_request");
    yield* refuse(
      { ...proposal, tasks: [{ ...proposal.tasks[0]!, runtimeMode: "full-access" }] },
      { parentRuntimeMode: "auto-accept-edits" },
    );
    assert.lengthOf(dispatched, 0);
  }),
);

it.live("closes the card as expired when nobody answers in time", () =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    const result = yield* propose({ ...proposal, timeoutMs: 1_000 }).pipe(
      Effect.provide(makeLayer({ dispatched })),
    );

    assert.equal(result.status, "timed_out");
    assert.deepEqual(result.started, []);
    const statuses = dispatched.flatMap((command) =>
      command.type === "child_plan.record" ? [command.planStatus] : [],
    );
    assert.deepEqual(statuses, ["pending", "expired"]);
    assert.isFalse(dispatched.some((command) => command.type === "delegated_task.request"));
  }),
);
