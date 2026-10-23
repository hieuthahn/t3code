import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ThreadRunSummary } from "@t3tools/client-runtime/state/models";
import type { OrchestrationV2ProjectedTurnItem, ScopedThreadRef } from "@t3tools/contracts";

import { getTriggerDisplayModelLabel } from "../chat/providerIconUtils";
import type { SidebarProviderEntry } from "../sidebar/SidebarThreadRow";

const MIN_COMPARE_THREADS = 2;
const MAX_COMPARE_THREADS = 8;

export interface CompareSearch {
  readonly threads?: string;
}

/**
 * Read the threads a compare page shows from its search, or null when they cannot be compared.
 * Keys must parse, stay within one environment, and number 2 to 8 once duplicates drop.
 */
export function parseCompareThreads(threads: string | undefined): ScopedThreadRef[] | null {
  if (threads === undefined) return null;
  const refs = new Map<string, ScopedThreadRef>();
  for (const key of threads.split(",")) {
    const ref = parseScopedThreadKey(key.trim());
    if (ref !== null) refs.set(key.trim(), ref);
  }
  const unique = [...refs.values()];
  if (unique.length < MIN_COMPARE_THREADS || unique.length > MAX_COMPARE_THREADS) return null;
  const environmentId = unique[0]!.environmentId;
  return unique.every((ref) => ref.environmentId === environmentId) ? unique : null;
}

export interface LatestReply {
  readonly prompt: string | null;
  readonly reply: string | null;
  readonly streaming: boolean;
}

/** Return the last user prompt of a thread and every assistant message sent after it. */
export function latestReply(items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>): LatestReply {
  const lastPromptIndex = items.findLastIndex(({ item }) => item.type === "user_message");
  const promptItem = lastPromptIndex === -1 ? undefined : items[lastPromptIndex]!.item;
  const replies = items
    .slice(lastPromptIndex + 1)
    .flatMap(({ item }) => (item.type === "assistant_message" ? [item] : []));
  const text = replies
    .map((reply) => reply.text.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
  return {
    prompt: promptItem?.type === "user_message" ? promptItem.text : null,
    reply: text.length > 0 ? text : null,
    streaming: replies.at(-1)?.streaming === true,
  };
}

/** Return the prompt every column shares, or null when the threads were asked different things. */
export function sharedPrompt(prompts: ReadonlyArray<string | null>): string | null {
  const first = prompts[0];
  if (first == null) return null;
  return prompts.every((prompt) => prompt === first) ? first : null;
}

export type CompareRunTone = "working" | "done" | "failed" | "stopped" | "idle";

export interface CompareRunState {
  readonly tone: CompareRunTone;
  readonly label: string;
  readonly durationMs: number | null;
}

const WORKING_RUN_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);

function spanMs(from: string | null, to: string | number | null): number | null {
  if (from === null || to === null) return null;
  const startMs = Date.parse(from);
  const endMs = typeof to === "number" ? to : Date.parse(to);
  return Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : null;
}

/** Describe a branch's latest run as a status label with its elapsed or total time. */
export function describeCompareRun(run: ThreadRunSummary | null, nowMs: number): CompareRunState {
  if (run === null) return { tone: "idle", label: "Not started", durationMs: null };
  const startedAt = run.startedAt ?? run.requestedAt;
  if (WORKING_RUN_STATUSES.has(run.status) && run.turnEnded !== true) {
    return { tone: "working", label: "Working", durationMs: spanMs(startedAt, nowMs) };
  }
  const durationMs = spanMs(startedAt, run.completedAt);
  switch (run.status) {
    case "failed":
      return { tone: "failed", label: "Failed", durationMs };
    case "interrupted":
    case "cancelled":
      return { tone: "stopped", label: "Stopped", durationMs };
    case "rolled_back":
      return { tone: "stopped", label: "Rolled back", durationMs };
    default:
      return { tone: "done", label: "Done", durationMs };
  }
}

/** Name a thread's model the way the model picker does, falling back to its slug. */
export function compareModelLabel(
  entry: Pick<SidebarProviderEntry, "models"> | undefined,
  model: string,
): string {
  const selected = entry?.models.find((candidate) => candidate.slug === model);
  return selected ? getTriggerDisplayModelLabel(selected) : model;
}
