import {
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ChildProposal,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  childPlanChildState,
  childPlanDecideInput,
  childPlanDisplay,
  type ChildPlanItem,
} from "./childPlan.ts";

const proposal = (key: string): OrchestrationV2ChildProposal => ({
  key,
  title: `Do ${key}`,
  brief: `Do the ${key} part`,
  isolation: "worktree",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "auto-accept-edits",
  interactionMode: "default",
});

const plan = (overrides: Partial<ChildPlanItem> = {}): ChildPlanItem =>
  ({
    id: TurnItemId.make("turn-item:child-plan:1"),
    threadId: ThreadId.make("thread-parent"),
    type: "child_plan_request",
    status: "waiting",
    planId: "child-plan:1",
    revision: 2,
    planStatus: "pending",
    children: [proposal("api"), proposal("ui"), proposal("docs")],
    planDecision: null,
    ...overrides,
  }) as ChildPlanItem;

const decided = plan({
  status: "completed",
  planStatus: "partially_approved",
  planDecision: {
    decidedBy: { actor: "user", authSessionId: "session:web" as never },
    revision: 2,
    approvedKeys: ["api", "ui"],
    declinedKeys: ["docs"],
  },
});

describe("childPlanDisplay", () => {
  it("asks for a pick only on the thread that proposed it", () => {
    expect(childPlanDisplay(plan(), "local").kind).toBe("pending");
    expect(childPlanDisplay(plan(), "inherited")).toEqual({
      kind: "pending-elsewhere",
      label: "Waiting for a decision in the original thread",
    });
  });

  it("counts started, starting, failed and declined children after the decision", () => {
    expect(childPlanDisplay(decided, "local")).toEqual({
      kind: "decided",
      label: "Starting 2 · 1 declined",
    });
    const launched = plan({
      ...decided,
      launches: [
        { key: "api", taskId: "node:api" as never, childThreadId: ThreadId.make("thread-api") },
        { key: "ui", failure: "The parent run ended before ui started." },
      ],
    });
    expect(childPlanDisplay(launched, "local")).toEqual({
      kind: "decided",
      label: "1 started · 1 failed · 1 declined",
    });
    expect(childPlanChildState(launched, "api")).toEqual({
      state: "started",
      childThreadId: "thread-api",
    });
    expect(childPlanChildState(launched, "ui")).toEqual({
      state: "failed",
      failure: "The parent run ended before ui started.",
    });
    expect(childPlanChildState(launched, "docs")).toEqual({ state: "declined" });
  });

  it("names a proposal nobody answered or the agent withdrew", () => {
    expect(
      childPlanDisplay(plan({ planStatus: "declined", status: "completed" }), "local"),
    ).toEqual({ kind: "decided", label: "Declined" });
    expect(childPlanDisplay(plan({ planStatus: "expired" }), "local")).toEqual({
      kind: "closed",
      label: "Expired before a decision",
    });
    expect(childPlanDisplay(plan({ planStatus: "cancelled" }), "local")).toEqual({
      kind: "closed",
      label: "Closed before a decision",
    });
  });
});

describe("childPlanDecideInput", () => {
  it("keeps the proposal's order and revision and drops unknown keys", () => {
    expect(childPlanDecideInput(plan(), ["docs", "api", "gone"])).toEqual({
      threadId: "thread-parent",
      turnItemId: "turn-item:child-plan:1",
      revision: 2,
      approvedKeys: ["api", "docs"],
    });
  });
});
