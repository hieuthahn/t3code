import type { OrchestrationV2Run, RunId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

const SIDE_QUESTION_TITLE_LENGTH = 60;

type SideQuestionShell = Pick<
  EnvironmentThreadShell,
  "id" | "lineage" | "archivedAt" | "createdAt"
>;

/** `/btw <question>` returns the question, `""` when it is missing, and `null` for other text. */
export function parseSideQuestionCommand(text: string): string | null {
  const match = /^\/btw(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  return match[1]?.trim() ?? "";
}

export function sideQuestionTitle(question: string): string {
  const line = question.replace(/\s+/g, " ").trim();
  return line.length <= SIDE_QUESTION_TITLE_LENGTH
    ? line
    : `${line.slice(0, SIDE_QUESTION_TITLE_LENGTH - 1).trimEnd()}…`;
}

/** The newest run a side chat reads from; the server also reads any turn still in progress. */
export function latestSideChatSourceRunId(
  runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "ordinal" | "status">>,
): RunId | null {
  let latest: Pick<OrchestrationV2Run, "id" | "ordinal"> | null = null;
  for (const run of runs) {
    if (run.status !== "rolled_back" && (latest === null || run.ordinal > latest.ordinal)) {
      latest = run;
    }
  }
  return latest?.id ?? null;
}

const SIDE_CHAT_TITLE = "Side chat";

/** `Side chat`, then `Side chat 2` and up, taking the lowest number the open tabs leave free. */
export function nextSideChatTitle(openTitles: ReadonlyArray<string>): string {
  const taken = new Set(openTitles);
  for (let number = 1; ; number += 1) {
    const title = number === 1 ? SIDE_CHAT_TITLE : `${SIDE_CHAT_TITLE} ${number}`;
    if (!taken.has(title)) return title;
  }
}

export const SIDE_CHAT_PLACEHOLDER =
  "Ask about this session. The side chat can read the whole main chat up to now; nothing you ask here is added to it.";

function mainThreadIdIn(
  threadId: ThreadId,
  byId: ReadonlyMap<ThreadId, SideQuestionShell>,
): ThreadId {
  const visited = new Set<ThreadId>();
  let current = byId.get(threadId);
  let mainId = threadId;
  while (current?.lineage.sideQuestion === true && current.lineage.parentThreadId !== null) {
    if (visited.has(current.id)) return threadId;
    visited.add(current.id);
    mainId = current.lineage.parentThreadId;
    current = byId.get(mainId);
  }
  return mainId;
}

/** The thread whose tab strip a thread belongs to: itself, or the first non-side-question ancestor. */
export function sideQuestionMainThreadId(
  threadId: ThreadId,
  threads: ReadonlyArray<SideQuestionShell>,
): ThreadId {
  return mainThreadIdIn(threadId, new Map(threads.map((thread) => [thread.id, thread] as const)));
}

export function openSideQuestions<T extends SideQuestionShell>(
  mainThreadId: ThreadId,
  threads: ReadonlyArray<T>,
): T[] {
  const byId = new Map<ThreadId, SideQuestionShell>(
    threads.map((thread) => [thread.id, thread] as const),
  );
  return threads
    .filter(
      (thread) =>
        thread.lineage.sideQuestion === true &&
        thread.archivedAt === null &&
        mainThreadIdIn(thread.id, byId) === mainThreadId,
    )
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}
