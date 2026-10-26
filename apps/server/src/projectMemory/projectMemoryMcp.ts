import {
  OrchestratorMcpFailure,
  type OrchestratorMcpProjectMemoryAppendInput,
  type OrchestratorMcpProjectMemoryAppendResult,
  type OrchestratorMcpProjectMemoryReadResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectMemoryService from "./ProjectMemoryService.ts";

const failure = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });

/** The project of the thread that called, or a clear error when it has none. */
const projectOfCaller = Effect.gen(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const threadId = scope.thread?.threadId;
  if (threadId === undefined) {
    return yield* failure("Project memory needs an agent running inside a T3 thread.");
  }
  const shell = yield* threads.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null));
  if (shell === null) {
    return yield* failure("This thread belongs to no project, so it has no project memory.");
  }
  return { threadId, projectId: shell.projectId };
});

export const readProjectMemory: Effect.Effect<
  OrchestratorMcpProjectMemoryReadResult,
  OrchestratorMcpFailure,
  | McpInvocationContext.McpInvocationContext
  | ThreadManagementService.ThreadManagementService
  | ProjectMemoryService.ProjectMemoryService
> = Effect.gen(function* () {
  const { projectId } = yield* projectOfCaller;
  const memory = yield* ProjectMemoryService.ProjectMemoryService;
  const entries = yield* memory.list(projectId);
  return { entries };
}).pipe(
  Effect.mapError((error) =>
    error._tag === "ProjectMemoryError" ? failure(error.message) : error,
  ),
);

export const appendProjectMemory = Effect.fn("ProjectMemory.mcpAppend")(
  function* (input: OrchestratorMcpProjectMemoryAppendInput) {
    const { projectId, threadId } = yield* projectOfCaller;
    const memory = yield* ProjectMemoryService.ProjectMemoryService;
    const entry = yield* memory.append({ projectId, text: input.text, authorThreadId: threadId });
    return { entry } satisfies OrchestratorMcpProjectMemoryAppendResult;
  },
  Effect.mapError((error) =>
    error._tag === "ProjectMemoryError" ? failure(error.message) : error,
  ),
);
