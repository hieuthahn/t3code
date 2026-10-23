import { ProviderInstanceId, RunId } from "@t3tools/contracts";
import type { ThreadRunSummary, ThreadRuntimeSummary } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import {
  bucketByStatus,
  sidebarStatusBucketOf,
  type SidebarStatusInput,
} from "./sidebarStatusBuckets";

function runtime(status: ThreadRuntimeSummary["status"]): ThreadRuntimeSummary {
  return {
    status,
    activeRunId: null,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerName: null,
    lastError: null,
    updatedAt: "2026-10-23T10:00:00.000Z",
  };
}

function latestRun(status: ThreadRunSummary["status"]): ThreadRunSummary {
  return {
    runId: RunId.make("run-1"),
    status,
    requestedAt: "2026-10-23T09:59:00.000Z",
    startedAt: "2026-10-23T09:59:00.000Z",
    completedAt: "2026-10-23T10:00:00.000Z",
    assistantMessageId: null,
  };
}

function thread(overrides: Partial<SidebarStatusInput> = {}): SidebarStatusInput {
  return {
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingSubagentRequest: null,
    hasActionableProposedPlan: false,
    interactionMode: "default",
    latestRun: latestRun("completed"),
    runtime: runtime("completed"),
    ...overrides,
  };
}

describe("sidebarStatusBucketOf", () => {
  it.each([
    ["a pending approval", thread({ hasPendingApprovals: true, runtime: runtime("running") })],
    ["a question for the user", thread({ hasPendingUserInput: true, runtime: runtime("running") })],
    ["a child's pending approval", thread({ pendingSubagentRequest: "approval" })],
    ["a child's question", thread({ pendingSubagentRequest: "user_input" })],
    [
      "a plan awaiting accept",
      thread({ interactionMode: "plan", hasActionableProposedPlan: true }),
    ],
    ["a failed turn", thread({ latestRun: latestRun("failed"), runtime: runtime("failed") })],
    [
      "a stopped turn",
      thread({ latestRun: latestRun("interrupted"), runtime: runtime("interrupted") }),
    ],
    [
      "a cancelled turn",
      thread({ latestRun: latestRun("cancelled"), runtime: runtime("cancelled") }),
    ],
    ["a failed turn with no runtime", thread({ latestRun: latestRun("failed"), runtime: null })],
  ])("puts %s in Needs input", (_name, input) => {
    expect(sidebarStatusBucketOf(input)).toBe("needs-input");
  });

  it.each([
    ["preparing", "preparing"],
    ["queued", "queued"],
    ["starting", "starting"],
    ["running", "running"],
    ["waiting on a checkpoint", "waiting"],
  ] as const)("puts a %s turn in Working", (_name, status) => {
    expect(sidebarStatusBucketOf(thread({ runtime: runtime(status) }))).toBe("working");
  });

  it("keeps a new turn after a failure in Working", () => {
    expect(
      sidebarStatusBucketOf(
        thread({ latestRun: latestRun("failed"), runtime: runtime("running") }),
      ),
    ).toBe("working");
  });

  it("keeps a running plan turn in Working until its plan is ready", () => {
    expect(
      sidebarStatusBucketOf(
        thread({
          interactionMode: "plan",
          hasActionableProposedPlan: true,
          runtime: runtime("running"),
        }),
      ),
    ).toBe("working");
  });

  it.each([
    ["a finished turn", thread()],
    ["a rolled back turn", thread({ latestRun: latestRun("rolled_back") })],
    ["a thread that never ran", thread({ latestRun: null, runtime: null })],
    ["a finished turn that left commands running", thread({ runtime: runtime("idle") })],
    ["a plan already handled", thread({ interactionMode: "plan" })],
  ])("puts %s in Completed", (_name, input) => {
    expect(sidebarStatusBucketOf(input)).toBe("completed");
  });
});

describe("bucketByStatus", () => {
  const items = [
    { id: "done-a", bucket: "completed" },
    { id: "run-a", bucket: "working" },
    { id: "ask-a", bucket: "needs-input" },
    { id: "done-b", bucket: "completed" },
  ] as const;

  it("orders Needs input, Working, Completed and keeps input order inside each", () => {
    const buckets = bucketByStatus(
      items,
      (item) => item.bucket,
      () => undefined,
    );

    expect(buckets.map((bucket) => [bucket.bucket, bucket.label])).toEqual([
      ["needs-input", "Needs input"],
      ["working", "Working"],
      ["completed", "Completed"],
    ]);
    expect(buckets[2]!.items.map((item) => item.id)).toEqual(["done-a", "done-b"]);
  });

  it("drops empty buckets", () => {
    const buckets = bucketByStatus(
      [items[0], items[3]],
      (item) => item.bucket,
      () => undefined,
    );

    expect(buckets.map((bucket) => bucket.bucket)).toEqual(["completed"]);
  });

  it("keeps a multiple-models send together under its most urgent member", () => {
    const buckets = bucketByStatus(
      items,
      (item) => item.bucket,
      (item) => (item.id === "done-a" || item.id === "run-a" ? "send-1" : undefined),
    );

    expect(buckets.map((bucket) => [bucket.bucket, bucket.items.map((item) => item.id)])).toEqual([
      ["needs-input", ["ask-a"]],
      ["working", ["done-a", "run-a"]],
      ["completed", ["done-b"]],
    ]);
  });
});
