import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectMemoryService from "./ProjectMemoryService.ts";
import { appendProjectMemory, readProjectMemory } from "./projectMemoryMcp.ts";

const projectId = ProjectId.make("project:mcp");
const callerId = ThreadId.make("thread:caller");
const siblingId = ThreadId.make("thread:sibling");
const ghostId = ThreadId.make("thread:ghost");
const brokenId = ThreadId.make("thread:broken");

const scopeFor = (threadId: ThreadId | undefined): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment:mcp"),
  requestNamespace: "provider-session:mcp",
  thread:
    threadId === undefined
      ? undefined
      : {
          threadId,
          providerSessionId: "session:mcp",
          providerInstanceId: ProviderInstanceId.make("claudeAgent"),
        },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
});

const layer = Layer.mergeAll(
  ProjectMemoryService.layer,
  Layer.mock(ThreadManagementService.ThreadManagementService)({
    getThreadShell: (threadId) =>
      threadId === ghostId
        ? Effect.succeed(null)
        : threadId === brokenId
          ? Effect.fail(new Error("db down") as never)
          : Effect.succeed({ id: threadId, projectId } as unknown as OrchestrationV2ThreadShell),
  }),
).pipe(Layer.provideMerge(Layer.mergeAll(SqlitePersistence.layerMemory, NodeServices.layer)));

const as = <A, E, R>(threadId: ThreadId | undefined, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provideService(McpInvocationContext.McpInvocationContext, scopeFor(threadId)));

it.effect("reads an empty memory", () =>
  Effect.gen(function* () {
    assert.deepEqual((yield* as(callerId, readProjectMemory)).entries, []);
  }).pipe(Effect.provide(layer)),
);

it.effect("shares an appended entry with a sibling thread of the same project", () =>
  Effect.gen(function* () {
    const { entry } = yield* as(callerId, appendProjectMemory({ text: "  prefer Effect.fn  " }));
    assert.equal(entry.text, "prefer Effect.fn");
    assert.equal(entry.authorThreadId, callerId);
    const seen = yield* as(siblingId, readProjectMemory);
    assert.deepEqual(
      seen.entries.map((listed) => listed.text),
      ["prefer Effect.fn"],
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("tells a caller outside any thread that memory needs a thread", () =>
  Effect.gen(function* () {
    const read = yield* as(undefined, readProjectMemory).pipe(Effect.flip);
    assert.include(read.message, "inside a T3 thread");
    const append = yield* as(undefined, appendProjectMemory({ text: "x" })).pipe(Effect.flip);
    assert.include(append.message, "inside a T3 thread");
  }).pipe(Effect.provide(layer)),
);

it.effect("tells a thread the app cannot find that it has no project memory", () =>
  Effect.gen(function* () {
    const read = yield* as(ghostId, readProjectMemory).pipe(Effect.flip);
    assert.include(read.message, "belongs to no project");
    const append = yield* as(ghostId, appendProjectMemory({ text: "x" })).pipe(Effect.flip);
    assert.include(append.message, "belongs to no project");
  }).pipe(Effect.provide(layer)),
);

it.effect("reports an over-cap append as an invalid request with the limit", () =>
  Effect.gen(function* () {
    const error = yield* as(callerId, appendProjectMemory({ text: "y".repeat(501) })).pipe(
      Effect.flip,
    );
    assert.equal(error.code, "invalid_request");
    assert.include(error.message, "at most 500 characters");
  }).pipe(Effect.provide(layer)),
);

it.effect("reports a failed thread lookup as an error, not as a missing project", () =>
  Effect.gen(function* () {
    const read = yield* as(brokenId, readProjectMemory).pipe(Effect.flip);
    assert.include(read.message, "Could not look up");
    assert.notInclude(read.message, "belongs to no project");
  }).pipe(Effect.provide(layer)),
);
