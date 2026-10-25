import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { newMessageId, newThreadId } from "~/lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readThreadShells, waitForThreadShell } from "../../state/entities";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  latestSideChatSourceRunId,
  nextSideChatTitle,
  openSideQuestions,
  sideQuestionMainThreadId,
  sideQuestionTitle,
} from "./sideQuestions.logic";

const failureMessage = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "The side chat could not start.";
};

const warn = (title: string, description: string) => {
  toastManager.add(stackedThreadToast({ type: "warning", title, description }));
  return false;
};

/** Whether the thread, or the main chat it is a side chat of, has a turn for a side chat to read. */
export function canOpenSideChatFrom(ref: ScopedThreadRef): boolean {
  const threads = readThreadShells().filter((thread) => thread.environmentId === ref.environmentId);
  const mainRef = scopeThreadRef(ref.environmentId, sideQuestionMainThreadId(ref.threadId, threads));
  const runs = appAtomRegistry.get(environmentThreadDetails.threadAtom(mainRef))?.projection?.runs;
  return latestSideChatSourceRunId(runs ?? []) !== null;
}

/**
 * Forks the main chat into a side chat tab. The server hands the side chat the whole main chat
 * up to its first message, including a turn still running, and the main thread gets no turn.
 */
function useForkSideChat() {
  const forkThreadFromRun = useAtomCommand(threadEnvironment.forkFromRun, {
    reportFailure: false,
  });

  return async (input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly question: string | null;
  }): Promise<ScopedThreadRef | null> => {
    const threads = readThreadShells().filter(
      (thread) => thread.environmentId === input.environmentId,
    );
    const mainThreadId = sideQuestionMainThreadId(input.threadId, threads);
    const mainRef = scopeThreadRef(input.environmentId, mainThreadId);
    const runs =
      appAtomRegistry.get(environmentThreadDetails.threadAtom(mainRef))?.projection?.runs ?? [];
    const runId = latestSideChatSourceRunId(runs);
    if (runId === null) {
      warn("Nothing to ask about yet", "A side chat reads the main chat. Send a message there first.");
      return null;
    }
    const targetThreadId = newThreadId();
    const forked = await forkThreadFromRun({
      environmentId: input.environmentId,
      input: {
        sourceThreadId: mainThreadId,
        targetThreadId,
        runId,
        title:
          input.question === null
            ? nextSideChatTitle(
                openSideQuestions(mainThreadId, threads).map((thread) => thread.title),
              )
            : sideQuestionTitle(input.question),
        sideQuestion: true,
      },
    });
    if (forked._tag === "Failure") {
      if (!isAtomCommandInterrupted(forked)) {
        warn("Side chat not started", failureMessage(forked));
      }
      return null;
    }
    const targetRef = scopeThreadRef(input.environmentId, targetThreadId);
    if (!(await waitForThreadShell(targetRef))) {
      warn(
        "Side chat not opened",
        "It was created, but its data did not reach this client. Reconnect and try again.",
      );
      return null;
    }
    return targetRef;
  };
}

/** Opens an empty side chat tab beside the main chat, the way the thread menu and the tab strip's + do. */
export function useOpenSideChat() {
  const navigate = useNavigate();
  const forkSideChat = useForkSideChat();

  return async (input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
  }): Promise<boolean> => {
    const targetRef = await forkSideChat({ ...input, question: null });
    if (targetRef === null) return false;
    await navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(targetRef) });
    return true;
  };
}

/** `/btw <question>`: opens a side chat tab and asks it the question. */
export function useSideQuestion() {
  const navigate = useNavigate();
  const forkSideChat = useForkSideChat();
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });

  return async (input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly question: string;
  }): Promise<boolean> => {
    if (input.question === "") {
      return warn("Add a question", "Type your question after /btw.");
    }
    const targetRef = await forkSideChat(input);
    if (targetRef === null) return false;
    const started = await startThreadTurn({
      environmentId: input.environmentId,
      input: {
        threadId: targetRef.threadId,
        message: { messageId: newMessageId(), role: "user", text: input.question, attachments: [] },
        runtimeMode: "approval-required",
        interactionMode: "default",
        dispatchMode: "start",
      },
    });
    await navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(targetRef) });
    if (started._tag === "Failure" && !isAtomCommandInterrupted(started)) {
      warn("Side question not sent", failureMessage(started));
    }
    return true;
  };
}
