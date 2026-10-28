import type { MessageId, RunId } from "@t3tools/contracts";

import { deriveRevertTurnCountByUserMessageId, type TimelineEntry } from "../../session-logic";
import type { SessionPhase, TurnDiffSummary } from "../../types";

export const REWIND_UNSUPPORTED_MESSAGE =
  "This provider does not support reverting conversation history. Start a new thread instead.";
export const REWIND_RUNNING_MESSAGE = "Interrupt the current turn before reverting checkpoints.";

export function reconnectBeforeRevertMessage(environmentLabel: string): string {
  return `Reconnect ${environmentLabel} before reverting checkpoints.`;
}

export interface RewindEntry {
  readonly messageId: MessageId;
  readonly turnCount: number;
  readonly preview: string;
  readonly createdAt: string;
}

function promptPreview(text: string): string {
  const firstLine = text.split("\n").find((line) => line.trim().length > 0);
  return firstLine?.trim() ?? "(no text)";
}

/** Lists the revertible user prompts, newest first, using the timeline's own revert targets. */
export function buildRewindEntries(input: {
  readonly timelineEntries: ReadonlyArray<TimelineEntry>;
  readonly checkpoints: ReadonlyArray<TurnDiffSummary>;
  readonly threadStartCheckpointReady: boolean;
  readonly availableRevertTurnCounts?: ReadonlySet<number> | undefined;
  readonly unsettledRunId: RunId | null;
}): ReadonlyArray<RewindEntry> {
  const turnCountByMessageId = deriveRevertTurnCountByUserMessageId(input);
  const entries: RewindEntry[] = [];
  for (const entry of input.timelineEntries) {
    if (entry.kind !== "message") continue;
    const turnCount = turnCountByMessageId.get(entry.message.id);
    if (turnCount === undefined) continue;
    entries.push({
      messageId: entry.message.id,
      turnCount,
      preview: promptPreview(entry.message.text),
      createdAt: entry.message.createdAt,
    });
  }
  return entries.toReversed();
}

export function rewindUnavailableReason(input: {
  readonly supportsConversationRollback: boolean;
  readonly environmentUnavailableLabel: string | null;
  readonly phase: SessionPhase;
  readonly isSendBusy: boolean;
  readonly isConnecting: boolean;
  readonly isRevertingCheckpoint: boolean;
}): string | null {
  if (!input.supportsConversationRollback) return REWIND_UNSUPPORTED_MESSAGE;
  if (input.environmentUnavailableLabel !== null) {
    return reconnectBeforeRevertMessage(input.environmentUnavailableLabel);
  }
  if (input.phase === "running" || input.isSendBusy || input.isConnecting) {
    return REWIND_RUNNING_MESSAGE;
  }
  if (input.isRevertingCheckpoint) return "A rewind is already in progress.";
  return null;
}
