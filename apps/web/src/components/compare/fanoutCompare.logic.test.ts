import type { ThreadRunSummary } from "@t3tools/client-runtime/state/models";
import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  compareModelLabel,
  describeCompareRun,
  latestReply,
  parseCompareThreads,
  sharedPrompt,
} from "./fanoutCompare.logic";

function item(
  position: number,
  body:
    | { readonly type: "user_message"; readonly text: string }
    | { readonly type: "assistant_message"; readonly text: string; readonly streaming?: boolean }
    | { readonly type: "reasoning"; readonly text: string },
): OrchestrationV2ProjectedTurnItem {
  const streaming = body.type === "user_message" ? {} : { streaming: false };
  return {
    position,
    visibility: "local",
    sourceThreadId: "thread-1",
    sourceItemId: `item-${position}`,
    item: { id: `item-${position}`, ...streaming, ...body },
  } as unknown as OrchestrationV2ProjectedTurnItem;
}

describe("parseCompareThreads", () => {
  it("reads unique keys of one environment, in order", () => {
    expect(parseCompareThreads("env-1:a, env-1:b,env-1:a")).toEqual([
      { environmentId: "env-1", threadId: "a" },
      { environmentId: "env-1", threadId: "b" },
    ]);
  });

  it.each([
    ["a missing search", undefined],
    ["a single thread", "env-1:a"],
    ["threads from two environments", "env-1:a,env-2:b"],
    ["more than eight threads", Array.from({ length: 9 }, (_, i) => `env-1:t${i}`).join(",")],
    ["keys without an environment", "a,b"],
  ])("rejects %s", (_, threads) => {
    expect(parseCompareThreads(threads)).toBeNull();
  });
});

describe("latestReply", () => {
  it("joins every assistant message after the last prompt and skips reasoning", () => {
    const reply = latestReply([
      item(0, { type: "user_message", text: "First question" }),
      item(1, { type: "assistant_message", text: "Old answer" }),
      item(2, { type: "user_message", text: "Second question" }),
      item(3, { type: "reasoning", text: "Thinking" }),
      item(4, { type: "assistant_message", text: "Part one" }),
      item(5, { type: "assistant_message", text: "Part two", streaming: true }),
    ]);

    expect(reply).toEqual({
      prompt: "Second question",
      reply: "Part one\n\nPart two",
      streaming: true,
    });
  });

  it("returns no reply while the branch has not answered its prompt yet", () => {
    expect(latestReply([item(0, { type: "user_message", text: "Question" })])).toEqual({
      prompt: "Question",
      reply: null,
      streaming: false,
    });
  });

  it("keeps an assistant message that came before any prompt", () => {
    expect(latestReply([item(0, { type: "assistant_message", text: "Hello" })])).toEqual({
      prompt: null,
      reply: "Hello",
      streaming: false,
    });
  });
});

describe("sharedPrompt", () => {
  it("returns the prompt only when every branch was asked the same thing", () => {
    expect(sharedPrompt(["Same", "Same"])).toBe("Same");
    expect(sharedPrompt(["Same", "Follow-up"])).toBeNull();
    expect(sharedPrompt([null, null])).toBeNull();
  });
});

describe("describeCompareRun", () => {
  const NOW_MS = Date.parse("2026-10-23T09:00:10.000Z");
  const run = (overrides: Partial<ThreadRunSummary>): ThreadRunSummary =>
    ({
      runId: "run-1",
      status: "completed",
      requestedAt: "2026-10-23T09:00:00.000Z",
      startedAt: "2026-10-23T09:00:01.000Z",
      completedAt: "2026-10-23T09:00:05.000Z",
      assistantMessageId: null,
      ...overrides,
    }) as ThreadRunSummary;

  it.each([
    ["running", {}, "working", "Working", 9_000],
    ["queued", {}, "working", "Working", 9_000],
    ["running", { turnEnded: true }, "done", "Done", 4_000],
    ["completed", {}, "done", "Done", 4_000],
    ["failed", {}, "failed", "Failed", 4_000],
    ["interrupted", {}, "stopped", "Stopped", 4_000],
    ["cancelled", {}, "stopped", "Stopped", 4_000],
    ["rolled_back", {}, "stopped", "Rolled back", 4_000],
  ] as const)("describes a %s run %o", (status, extra, tone, label, durationMs) => {
    expect(describeCompareRun(run({ status, ...extra }), NOW_MS)).toEqual({
      tone,
      label,
      durationMs,
    });
  });

  it("describes a branch that never ran", () => {
    expect(describeCompareRun(null, NOW_MS)).toEqual({
      tone: "idle",
      label: "Not started",
      durationMs: null,
    });
  });
});

describe("compareModelLabel", () => {
  it("falls back to the model slug when the provider does not list it", () => {
    expect(compareModelLabel(undefined, "claude-haiku-4-5")).toBe("claude-haiku-4-5");
    expect(compareModelLabel({ models: [] }, "gpt-5.6-terra")).toBe("gpt-5.6-terra");
  });
});
