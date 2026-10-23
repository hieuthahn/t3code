import {
  OrchestratorMcpFailure,
  type OrchestratorMcpMergeEnqueueInput,
  type OrchestratorMcpMergeEnqueueResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { readCaller } from "../mcp/threadAccess.ts";
import * as MergeQueueService from "./MergeQueueService.ts";

/** Queue a child of the calling thread; the user approves the commit on the parent's panel. */
export const enqueueChildMerge = Effect.fn("mcp.mergeEnqueue")(function* (
  input: OrchestratorMcpMergeEnqueueInput,
) {
  const { caller } = yield* readCaller();
  if (caller === undefined) {
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "Only an agent running inside a T3 thread can queue its child sessions to merge.",
    });
  }
  const queue = yield* MergeQueueService.MergeQueueService;
  const item = yield* queue
    .enqueue({ callerThreadId: caller.id, childThreadId: input.childThreadId })
    .pipe(
      Effect.mapError(
        (error) => new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
      ),
    );
  return {
    itemId: item.id,
    status: item.status,
    trunkRef: item.trunkRef,
    childBranch: item.childBranch,
    headSha: item.headShaAtEnqueue,
  } satisfies OrchestratorMcpMergeEnqueueResult;
});
