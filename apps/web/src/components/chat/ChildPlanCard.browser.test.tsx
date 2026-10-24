import type { ChildPlanItem } from "@t3tools/client-runtime/child-plan";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ChildProposal,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

const state = vi.hoisted(() => ({ decide: vi.fn() }));

vi.mock(import("../../state/use-orchestration-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOrchestrationCommand: (() => state.decide) as never,
}));

import { V2EventTimelineRow } from "./TimelineV2EventRow";
import { TimelineRowCtx, type TimelineRow } from "./timelineRowContext";

const environmentId = EnvironmentId.make("env-1");
const proposal = (key: string, title: string): OrchestrationV2ChildProposal => ({
  key,
  title,
  brief: `Do the ${key} part`,
  isolation: key === "docs" ? "shared" : "worktree",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "auto-accept-edits",
  interactionMode: "default",
});
const pending = {
  id: TurnItemId.make("turn-item:child-plan:1"),
  threadId: ThreadId.make("thread-parent"),
  type: "child_plan_request",
  status: "waiting",
  planId: "child-plan:1",
  revision: 2,
  planStatus: "pending",
  reason: "Two halves touch different packages",
  children: [proposal("api", "Retry sends"), proposal("docs", "Document retry")],
  planDecision: null,
} as unknown as ChildPlanItem;

function timelineRow(item: ChildPlanItem) {
  const row = {
    kind: "event",
    id: item.id,
    projectedItem: { item, visibility: "local", sourceThreadId: item.threadId },
  } as unknown as Extract<TimelineRow, { kind: "event" }>;
  return (
    <TimelineRowCtx value={{ activeThreadEnvironmentId: environmentId } as never}>
      <V2EventTimelineRow row={row} />
    </TimelineRowCtx>
  );
}

describe("ChildPlanCard", () => {
  it("names each team worker beside its model", async () => {
    const teamRound = {
      ...pending,
      children: [
        { ...proposal("api", "Retry sends"), worker: 1 },
        { ...proposal("docs", "Document retry"), worker: 2 },
      ],
    } as unknown as ChildPlanItem;
    await using screen = await render(timelineRow(teamRound));

    await expect.element(screen.getByText("Worker 1 · gpt-5.4 · own worktree")).toBeVisible();
    await expect.element(screen.getByText("Worker 2 · gpt-5.4 · shared folder")).toBeVisible();
  });

  it("starts only the child sessions left ticked, at the revision shown", async () => {
    state.decide.mockReset().mockResolvedValue(AsyncResult.success({ sequence: 1 }));
    await using screen = await render(timelineRow(pending));

    await expect.element(screen.getByText("Start child sessions?")).toBeVisible();
    await expect.element(screen.getByText("gpt-5.4 · shared folder")).toBeVisible();
    await screen.getByRole("checkbox").nth(1).click();
    const start = screen.getByRole("button", { name: "Start 1 child session" });
    await start.click();

    expect(state.decide).toHaveBeenCalledWith({
      environmentId,
      input: {
        threadId: "thread-parent",
        turnItemId: "turn-item:child-plan:1",
        revision: 2,
        approvedKeys: ["api"],
      },
    });
  });

  it("declines every child and shows why the server refused", async () => {
    state.decide
      .mockReset()
      .mockResolvedValue(
        AsyncResult.failure(Cause.fail(new Error("The proposal changed. Review it again."))),
      );
    await using screen = await render(timelineRow(pending));

    await screen.getByRole("button", { name: "Decline all" }).click();

    expect(state.decide.mock.calls[0]?.[0].input.approvedKeys).toEqual([]);
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("The proposal changed. Review it again.");
  });

  it("summarizes a decided proposal and names the child that failed to start", async () => {
    await using screen = await render(
      timelineRow({
        ...pending,
        status: "completed",
        planStatus: "approved",
        planDecision: {
          decidedBy: { actor: "user", authSessionId: "session:web" as never },
          revision: 2,
          approvedKeys: ["api", "docs"],
          declinedKeys: [],
        },
        launches: [
          { key: "api", childThreadId: ThreadId.make("thread-api") },
          { key: "docs", failure: "The parent run ended before docs started." },
        ],
      } as ChildPlanItem),
    );

    await expect.element(screen.getByText("2 child sessions · 1 started · 1 failed")).toBeVisible();
    await expect
      .element(screen.getByText("Document retry: The parent run ended before docs started."))
      .toBeVisible();
    expect(screen.container.querySelector("button")).toBeNull();
  });
});
