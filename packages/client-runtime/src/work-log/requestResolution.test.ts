import { describe, expect, it } from "vite-plus/test";

import {
  AuthSessionId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { requestResolutionLabel } from "./requestResolution.js";

const base = {
  id: TurnItemId.make("request"),
  threadId: ThreadId.make("thread"),
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: "completed",
  title: null,
  startedAt: null,
  completedAt: null,
  updatedAt: DateTime.makeUnsafe("2026-10-23T00:00:00.000Z"),
  requestId: RuntimeRequestId.make("request"),
} as const;

function approval(
  fields: Partial<Extract<OrchestrationV2TurnItem, { type: "approval_request" }>>,
): Extract<OrchestrationV2TurnItem, { type: "approval_request" }> {
  return { ...base, type: "approval_request", requestKind: "command", ...fields };
}

function question(
  fields: Partial<Extract<OrchestrationV2TurnItem, { type: "user_input_request" }>>,
): Extract<OrchestrationV2TurnItem, { type: "user_input_request" }> {
  return { ...base, type: "user_input_request", questions: [], ...fields };
}

const user = { actor: "user", authSessionId: AuthSessionId.make("session") } as const;
const agent = { actor: "agent", threadId: ThreadId.make("parent") } as const;
const answer = {
  requestId: RuntimeRequestId.make("request"),
  answers: { size: "large" },
  attachmentsByQuestionId: {},
};

describe("requestResolutionLabel", () => {
  it("names who made an approval decision", () => {
    expect(requestResolutionLabel(approval({ decision: "accept", decidedBy: user }))).toBe(
      "Approved by you",
    );
    expect(
      requestResolutionLabel(approval({ decision: "acceptForSession", decidedBy: user })),
    ).toBe("Approved for this session by you");
    expect(requestResolutionLabel(approval({ decision: "decline", decidedBy: agent }))).toBe(
      "Declined by an agent",
    );
  });

  it("keeps the decision alone for answers recorded before deciders were stamped", () => {
    expect(requestResolutionLabel(approval({ decision: "cancel" }))).toBe("Cancelled");
    expect(requestResolutionLabel(question({ questionAnswer: answer }))).toBe("Answered questions");
  });

  it("names who answered a question", () => {
    expect(requestResolutionLabel(question({ questionAnswer: answer, decidedBy: agent }))).toBe(
      "Answered by an agent",
    );
    expect(requestResolutionLabel(question({ questionAnswer: answer, decidedBy: user }))).toBe(
      "Answered by you",
    );
  });

  it("has no label while the request waits", () => {
    expect(requestResolutionLabel(approval({ status: "waiting" }))).toBeNull();
    expect(requestResolutionLabel(question({ status: "waiting" }))).toBeNull();
  });
});
