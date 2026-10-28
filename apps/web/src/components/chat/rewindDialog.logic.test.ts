import { MessageId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry } from "../../session-logic";
import {
  buildRewindEntries,
  REWIND_RUNNING_MESSAGE,
  REWIND_UNSUPPORTED_MESSAGE,
  rewindUnavailableReason,
} from "./rewindDialog.logic";

const runId = (ordinal: number) => RunId.make(`run-${ordinal}`);

function turn(ordinal: number, text = `prompt ${ordinal}`): TimelineEntry[] {
  return (["user", "assistant"] as const).map((role) => {
    const id = MessageId.make(`${role}-${ordinal}`);
    const createdAt = `2026-06-20T00:00:0${ordinal}.000Z`;
    return {
      id,
      kind: "message",
      createdAt,
      message: {
        id,
        role,
        text: role === "user" ? text : "reply",
        runId: runId(ordinal),
        ...(role === "user" ? { inputIntent: "turn_start" as const } : {}),
        streaming: false,
        createdAt,
        updatedAt: createdAt,
      },
    };
  });
}

function checkpoint(ordinal: number) {
  return {
    runId: runId(ordinal),
    checkpointTurnCount: ordinal,
    checkpointRef: `checkpoint-${ordinal}` as never,
    status: "ready" as const,
    files: [],
    assistantMessageId: MessageId.make(`assistant-${ordinal}`),
    completedAt: "2026-06-20T00:00:09.000Z",
  };
}

const base = {
  checkpoints: [checkpoint(1), checkpoint(2)],
  threadStartCheckpointReady: true,
  unsettledRunId: null,
};

describe("buildRewindEntries", () => {
  it("lists user prompts newest first with their revert targets", () => {
    const entries = buildRewindEntries({
      ...base,
      timelineEntries: [...turn(1), ...turn(2), ...turn(3)],
    });
    expect(entries.map((entry) => [entry.messageId, entry.turnCount])).toEqual([
      ["user-3", 2],
      ["user-2", 1],
      ["user-1", 0],
    ]);
  });

  it("skips the prompt of a run that is still unsettled", () => {
    const entries = buildRewindEntries({
      ...base,
      timelineEntries: [...turn(1), ...turn(2)],
      unsettledRunId: runId(2),
    });
    expect(entries.map((entry) => entry.messageId)).toEqual(["user-1"]);
  });

  it("skips prompts without a ready checkpoint to restore", () => {
    const entries = buildRewindEntries({
      ...base,
      checkpoints: [],
      threadStartCheckpointReady: false,
      timelineEntries: [...turn(1), ...turn(2)],
    });
    expect(entries).toEqual([]);
  });

  it("honours the available revert counts", () => {
    const entries = buildRewindEntries({
      ...base,
      availableRevertTurnCounts: new Set([1]),
      timelineEntries: [...turn(1), ...turn(2), ...turn(3)],
    });
    expect(entries.map((entry) => entry.messageId)).toEqual(["user-2"]);
  });

  it("previews the first non-empty line of the prompt", () => {
    const [entry] = buildRewindEntries({
      ...base,
      timelineEntries: turn(1, "\n  fix the login bug  \nand add a test"),
    });
    expect(entry?.preview).toBe("fix the login bug");
  });

  it("labels a prompt that has no text", () => {
    const [entry] = buildRewindEntries({ ...base, timelineEntries: turn(1, "   ") });
    expect(entry?.preview).toBe("(no text)");
  });

  it("keeps the creation time for the relative label", () => {
    const [entry] = buildRewindEntries({ ...base, timelineEntries: turn(1) });
    expect(entry?.createdAt).toBe("2026-06-20T00:00:01.000Z");
  });
});

describe("rewindUnavailableReason", () => {
  const ready = {
    supportsConversationRollback: true,
    environmentUnavailableLabel: null,
    phase: "ready" as const,
    isSendBusy: false,
    isConnecting: false,
    isRevertingCheckpoint: false,
  };

  it("is null when the thread can revert", () => {
    expect(rewindUnavailableReason(ready)).toBeNull();
  });

  it("explains an unsupported provider first", () => {
    expect(
      rewindUnavailableReason({
        ...ready,
        supportsConversationRollback: false,
        phase: "running",
      }),
    ).toBe(REWIND_UNSUPPORTED_MESSAGE);
  });

  it("asks to reconnect an unavailable environment", () => {
    expect(rewindUnavailableReason({ ...ready, environmentUnavailableLabel: "Remote box" })).toBe(
      "Reconnect Remote box before reverting checkpoints.",
    );
  });

  it.each([
    ["running", { phase: "running" as const }],
    ["sending", { isSendBusy: true }],
    ["connecting", { isConnecting: true }],
  ])("asks to interrupt while %s", (_label, overrides) => {
    expect(rewindUnavailableReason({ ...ready, ...overrides })).toBe(REWIND_RUNNING_MESSAGE);
  });

  it("reports a rewind already in progress", () => {
    expect(rewindUnavailableReason({ ...ready, isRevertingCheckpoint: true })).toBe(
      "A rewind is already in progress.",
    );
  });
});
