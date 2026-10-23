import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ServerCommand,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadProjection,
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

const parentThreadId = ThreadId.make("thread:report-parent");
const childThreadId = ThreadId.make("thread:report-child");
const taskId = NodeId.make("node:report-task");

const childScope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:report"),
  requestNamespace: "provider-session:report-child",
  thread: {
    threadId: childThreadId,
    providerSessionId: "provider-session:report-child",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

const projection = (thread: object, subagents: ReadonlyArray<object> = []) =>
  ({
    thread,
    runs: [],
    messages: [],
    subagents,
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    contextTransfers: [],
    turnItems: [],
  }) as unknown as OrchestrationV2ThreadProjection;

const startSha = "3333333333333333333333333333333333333333";

const gitOutputs = (childBranch: string): Readonly<Record<string, string>> => ({
  "rev-parse --is-inside-work-tree": "true",
  "rev-parse --abbrev-ref HEAD": childBranch,
  "rev-parse HEAD": "1111111111111111111111111111111111111111",
  "merge-base HEAD feat/parent": "2222222222222222222222222222222222222222",
  "rev-list --left-right --count 2222222222222222222222222222222222222222...HEAD": "0\t2",
  [`merge-base HEAD ${startSha}`]: startSha,
  [`rev-list --left-right --count ${startSha}...HEAD`]: "0\t5",
  "status --porcelain": "",
  "diff --no-renames --name-status 2222222222222222222222222222222222222222": "A\tsrc/report.ts",
  "diff --no-renames --numstat 2222222222222222222222222222222222222222": "12\t0\tsrc/report.ts",
  [`diff --no-renames --name-status ${startSha}`]: "M\tsrc/shared.ts",
  [`diff --no-renames --numstat ${startSha}`]: "3\t1\tsrc/shared.ts",
});

const makeLayer = (layerInput: {
  readonly childLineageParent: ThreadId | null;
  readonly childWorktreePath?: string | null;
  readonly childBranch?: string;
  readonly dispatched: Array<OrchestrationV2ServerCommand>;
  readonly gitCwds: Array<string>;
}) => {
  const input = {
    childWorktreePath: "/worktrees/report",
    childBranch: "update/report",
    ...layerInput,
  };
  const task = {
    id: taskId,
    threadId: parentThreadId,
    origin: "app_owned",
    childThreadId,
    status: "running",
    startCommitSha: startSha,
  } as unknown as OrchestrationV2Subagent;
  const dependencies = Layer.mergeAll(
    NodeServices.layer,
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadRecords: (threadId) =>
        Effect.succeed(
          threadId === childThreadId
            ? projection({
                id: childThreadId,
                projectId: ProjectId.make("project:report"),
                worktreePath: input.childWorktreePath,
                lineage: {
                  parentThreadId: input.childLineageParent,
                  relationshipToParent: input.childLineageParent === null ? null : "subagent",
                  rootThreadId: input.childLineageParent ?? childThreadId,
                },
              })
            : projection({ id: parentThreadId, branch: "feat/parent" }, [
                input.dispatched.length === 0 ? task : { ...task, report: { revision: 1 } },
              ]),
        ),
      dispatch: (command) =>
        Effect.sync(() => {
          input.dispatched.push(command);
          return {} as never;
        }),
    }),
    Layer.mock(ProjectService.ProjectService)({
      getById: () => Effect.succeed(Option.some({ workspaceRoot: "/repo" } as never)),
    }),
    Layer.mock(GitVcsDriver.GitVcsDriver)({
      execute: (git) =>
        Effect.sync(() => {
          input.gitCwds.push(git.cwd);
          const stdout = gitOutputs(input.childBranch)[git.args.join(" ")];
          return {
            exitCode: stdout === undefined ? 1 : 0,
            stdout: stdout ?? "",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
          } as never;
        }),
    }),
    ServerSettings.layerTest(),
    Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
    Layer.mock(ProviderAdapterRegistry.ProviderAdapterRegistryV2)({
      list: () => Effect.succeed([]),
    }),
    Layer.mock(SecretRequests.SecretRequests)({}),
    Layer.mock(RemoteDelegation.RemoteDelegation)({}),
    Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
    Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
  );
  return OrchestratorMcpService.layer.pipe(Layer.provide(dependencies));
};

it.effect("records a delegated child's report with the git facts of its own checkout", () =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    const gitCwds: Array<string> = [];
    const result = yield* Effect.gen(function* () {
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.reportTask(childScope, {
        status: "done",
        summary: "Added the report module.",
      });
    }).pipe(Effect.provide(makeLayer({ childLineageParent: parentThreadId, dispatched, gitCwds })));

    assert.equal(result.taskId, taskId);
    assert.equal(result.revision, 1);
    assert.equal(result.observed?.aheadBy, 2);
    assert.deepEqual(result.observed?.filesChanged, [
      { path: "src/report.ts", status: "A", additions: 12, deletions: 0 },
    ]);
    assert.isTrue(gitCwds.every((cwd) => cwd === "/worktrees/report"));
    const command = dispatched[0];
    assert.equal(command?.type, "child_report.record");
    if (command?.type !== "child_report.record") return;
    assert.equal(command.parentThreadId, parentThreadId);
    assert.equal(command.taskId, taskId);
    assert.deepEqual(command.claimed, {
      status: "done",
      summary: "Added the report module.",
      tests: [],
      questions: [],
    });
    assert.equal(command.observed?.baseRef, "feat/parent");
  }),
);

it.effect("reads a child in the parent's checkout from the commit its task started at", () =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    const gitCwds: Array<string> = [];
    const result = yield* Effect.gen(function* () {
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.reportTask(childScope, { status: "working", summary: "Halfway." });
    }).pipe(
      Effect.provide(
        makeLayer({
          childLineageParent: parentThreadId,
          childWorktreePath: null,
          childBranch: "feat/parent",
          dispatched,
          gitCwds,
        }),
      ),
    );

    assert.isTrue(gitCwds.every((cwd) => cwd === "/repo"));
    assert.equal(result.observed?.baseSha, startSha);
    assert.equal(result.observed?.aheadBy, 5);
    assert.deepEqual(
      result.observed?.filesChanged.map((file) => file.path),
      ["src/shared.ts"],
    );
  }),
);

it.effect("refuses a report from a thread that no delegated task started", () =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    const error = yield* Effect.gen(function* () {
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      return yield* service.reportTask(childScope, { status: "working", summary: "Hello" });
    }).pipe(
      Effect.flip,
      Effect.provide(makeLayer({ childLineageParent: null, dispatched, gitCwds: [] })),
    );

    assert.equal(error.code, "task_not_found");
    assert.lengthOf(dispatched, 0);
  }),
);
