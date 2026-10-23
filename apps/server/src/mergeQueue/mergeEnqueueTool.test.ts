import {
  EnvironmentId,
  MergeQueueError,
  MergeQueueItemId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { enqueueChildMerge } from "./mergeEnqueueTool.ts";
import * as MergeQueueService from "./MergeQueueService.ts";

const ownerThreadId = ThreadId.make("thread:merge-enqueue-owner");
const childThreadId = ThreadId.make("thread:merge-enqueue-child");

const makeScope = (
  overrides: Partial<McpInvocationContext.McpInvocationScope> = {},
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment:merge-enqueue"),
  requestNamespace: "provider-session-merge-enqueue",
  thread: {
    threadId: ownerThreadId,
    providerSessionId: "provider-session-merge-enqueue",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
  ...overrides,
});

const ownerShell = {
  id: ownerThreadId,
  projectId: ProjectId.make("project:merge-enqueue"),
  deletedAt: null,
  runtimeMode: "full-access",
  interactionMode: "default",
} as unknown as OrchestrationV2ThreadShell;

const queued = {
  id: MergeQueueItemId.make("merge-queue:one"),
  status: "awaiting_user",
  trunkRef: "main",
  childBranch: "t3/api",
  headShaAtEnqueue: "abc1234",
} as unknown as MergeQueueService.MergeQueueItem;

const run = (
  scope: McpInvocationContext.McpInvocationScope,
  enqueue: MergeQueueService.MergeQueueService["Service"]["enqueue"],
) =>
  enqueueChildMerge({ childThreadId }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(McpInvocationContext.McpInvocationContext, scope),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(ownerShell),
        }),
        Layer.mock(MergeQueueService.MergeQueueService)({ enqueue }),
      ),
    ),
  );

it.effect("queues the child for the calling thread and returns the commit to approve", () =>
  Effect.gen(function* () {
    const calls: Array<{ callerThreadId: ThreadId; childThreadId: ThreadId }> = [];
    const result = yield* run(makeScope(), (input) =>
      Effect.sync(() => {
        calls.push(input);
        return queued;
      }),
    );
    assert.deepEqual(calls, [{ callerThreadId: ownerThreadId, childThreadId }]);
    assert.deepEqual(result, {
      itemId: queued.id,
      status: "awaiting_user",
      trunkRef: "main",
      childBranch: "t3/api",
      headSha: "abc1234",
    });
  }),
);

it.effect("refuses a credential without orchestration", () =>
  Effect.gen(function* () {
    const result = yield* run(makeScope({ capabilities: new Set() }), () =>
      Effect.succeed(queued),
    ).pipe(Effect.result);
    assert.isTrue(Result.isFailure(result));
    if (Result.isFailure(result)) assert.equal(result.failure.code, "capability_denied");
  }),
);

it.effect("refuses a caller outside a thread", () =>
  Effect.gen(function* () {
    const result = yield* run(makeScope({ thread: undefined }), () => Effect.succeed(queued)).pipe(
      Effect.result,
    );
    assert.isTrue(Result.isFailure(result));
    if (Result.isFailure(result)) assert.equal(result.failure.code, "invalid_request");
  }),
);

it.effect("reports why the queue refused the child", () =>
  Effect.gen(function* () {
    const result = yield* run(makeScope(), () =>
      Effect.fail(new MergeQueueError({ message: "Only the thread that started this child" })),
    ).pipe(Effect.result);
    assert.isTrue(Result.isFailure(result));
    if (Result.isFailure(result)) {
      assert.equal(result.failure.code, "invalid_request");
      assert.include(result.failure.message, "Only the thread that started this child");
    }
  }),
);
