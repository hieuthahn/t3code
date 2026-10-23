import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  DEFAULT_TEAM_LIMITS,
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
  type TeamSetup,
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

const parentThreadId = ThreadId.make("thread:team-architect");
const parentRunId = RunId.make("run:propose-parent");
const parentNodeId = NodeId.make("node:propose-root");
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.4" };

const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:team"),
  requestNamespace: "provider-session:team",
  thread: {
    threadId: parentThreadId,
    providerSessionId: "provider-session:team",
    providerInstanceId: instanceId,
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

const workerInstanceId = ProviderInstanceId.make("codex_work");
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "test",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-23T00:00:00.000Z",
  models: [
    { slug: "gpt-5.4", name: "gpt-5.4", isCustom: false, capabilities: null },
    { slug: "gpt-5.4-mini", name: "gpt-5.4-mini", isCustom: false, capabilities: null },
  ],
  slashCommands: [],
  skills: [],
};
const workerProvider: ServerProvider = { ...provider, instanceId: workerInstanceId };
const team: TeamSetup = {
  architect: modelSelection,
  workers: [
    { instanceId: workerInstanceId, model: "gpt-5.4-mini" },
    { instanceId, model: "gpt-5.4" },
  ],
  limits: DEFAULT_TEAM_LIMITS,
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

function makeLayer(input: {
  readonly runStatus?: "running" | "completed";
  readonly parentRuntimeMode?: "full-access" | "auto-accept-edits";
  /** The keys the user approves as soon as the card shows; undefined never answers. */
  readonly approve?: ReadonlyArray<string>;
  readonly dispatched: Array<OrchestrationV2ServerCommand>;
  readonly team?: TeamSetup;
}) {
  let card: Extract<OrchestrationV2TurnItem, { readonly type: "child_plan_request" }> | undefined;
  const started: Array<ReturnType<typeof taskFor>> = [];
  const projection = (threadId: ThreadId) =>
    ({
      thread: {
        id: threadId,
        projectId: ProjectId.make("project:team"),
        title: "Refactor retry",
        createdBy: "user",
        creationSource: "web",
        modelSelection,
        runtimeMode: input.parentRuntimeMode ?? "full-access",
        interactionMode: "default",
        worktreePath: null,
        ...(threadId === parentThreadId && input.team !== undefined ? { team: input.team } : {}),
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
      getProviders: Effect.succeed([provider, workerProvider]),
      refreshInstance: () => Effect.succeed([provider, workerProvider]),
    }),
    Layer.succeed(
      ProviderAdapterRegistry.ProviderAdapterRegistryV2,
      ProviderAdapterRegistry.ProviderAdapterRegistryV2.of({
        list: () => Effect.succeed([instanceId, workerInstanceId]),
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

const call = <A, E>(
  use: (service: OrchestratorMcpService.OrchestratorMcpServiceShape) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    return yield* use(yield* OrchestratorMcpService.OrchestratorMcpService);
  });

const delegations = (dispatched: ReadonlyArray<OrchestrationV2ServerCommand>) =>
  dispatched.flatMap((command) =>
    command.type === "delegated_task.request" ? [command.modelSelection] : [],
  );

it.effect("sends a team's delegation to its first worker when no target is named", () =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    yield* call((service) =>
      service.delegateTask(scope, { task: "Retry sends", title: "Retry sends" }),
    ).pipe(Effect.provide(makeLayer({ dispatched, team })));
    assert.deepEqual(delegations(dispatched), [
      { instanceId: workerInstanceId, model: "gpt-5.4-mini", options: [] },
    ]);
  }),
);

it.effect("refuses a team delegation to a model outside the team", () =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    const refused = yield* call((service) =>
      service.delegateTask(scope, {
        task: "Retry sends",
        target: { providerInstanceId: workerInstanceId, model: "gpt-5.4" },
      }),
    ).pipe(Effect.flip, Effect.provide(makeLayer({ dispatched, team })));
    assert.equal((refused as { code?: string }).code, "invalid_request");
    assert.include((refused as Error).message, "codex_work:gpt-5.4-mini, codex:gpt-5.4");
    assert.deepEqual(delegations(dispatched), []);
  }),
);

it.effect("keeps a team's workers in this environment", () =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    const refused = yield* call((service) =>
      service.delegateTask(scope, {
        task: "Retry sends",
        target: { environmentId: EnvironmentId.make("environment:laptop") },
      }),
    ).pipe(Effect.flip, Effect.provide(makeLayer({ dispatched, team })));
    assert.equal((refused as { code?: string }).code, "invalid_request");
    assert.deepEqual(dispatched, []);
  }),
);

it.effect("proposes a team's children on its workers only", () =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    yield* call((service) =>
      service.proposeTasks(scope, {
        reason: "The server and the composer change apart.",
        tasks: [
          { key: "api", title: "Retry sends", task: "Do the api part" },
          {
            key: "ui",
            title: "Show retry state",
            task: "Do the ui part",
            target: { providerInstanceId: instanceId, model: "gpt-5.4" },
          },
        ],
      }),
    ).pipe(Effect.provide(makeLayer({ approve: ["api", "ui"], dispatched, team })));
    const record = dispatched.find((command) => command.type === "child_plan.record");
    assert.deepEqual(
      record?.type === "child_plan.record"
        ? record.children.map((child) => child.modelSelection)
        : [],
      [
        { instanceId: workerInstanceId, model: "gpt-5.4-mini", options: [] },
        { instanceId, model: "gpt-5.4", options: [] },
      ],
    );
  }),
);

it.effect("leaves a thread outside a team free to pick any model", () =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    yield* call((service) =>
      service.delegateTask(scope, {
        task: "Retry sends",
        target: { providerInstanceId: workerInstanceId, model: "gpt-5.4" },
      }),
    ).pipe(Effect.provide(makeLayer({ dispatched })));
    assert.deepEqual(delegations(dispatched), [{ instanceId: workerInstanceId, model: "gpt-5.4" }]);
  }),
);
