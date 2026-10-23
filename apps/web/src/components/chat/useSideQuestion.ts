import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { newMessageId, newThreadId } from "~/lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { waitForThreadShell } from "../../state/entities";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { latestForkableRunId, sideQuestionTitle } from "./sideQuestions.logic";

const failureMessage = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "The side question could not start.";
};

/**
 * Forks the thread at its newest settled run into a side question and asks it there, so the
 * main thread gets no turn and a running turn keeps going.
 */
export function useSideQuestion() {
  const navigate = useNavigate();
  const forkThreadFromRun = useAtomCommand(threadEnvironment.forkFromRun, {
    reportFailure: false,
  });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });

  return async (input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly question: string;
  }): Promise<boolean> => {
    const warn = (title: string, description: string) => {
      toastManager.add(stackedThreadToast({ type: "warning", title, description }));
      return false;
    };
    if (input.question === "") {
      return warn("Add a question", "Type your question after /btw.");
    }
    const sourceRef = scopeThreadRef(input.environmentId, input.threadId);
    const runs =
      appAtomRegistry.get(environmentThreadDetails.threadAtom(sourceRef))?.projection?.runs ?? [];
    const runId = latestForkableRunId(runs);
    if (runId === null) {
      return warn(
        "Nothing to ask about yet",
        "A side question starts from a finished turn. Wait for the first turn to finish.",
      );
    }
    const targetThreadId = newThreadId();
    const forked = await forkThreadFromRun({
      environmentId: input.environmentId,
      input: {
        sourceThreadId: input.threadId,
        targetThreadId,
        runId,
        title: sideQuestionTitle(input.question),
        sideQuestion: true,
      },
    });
    if (forked._tag === "Failure") {
      if (!isAtomCommandInterrupted(forked)) {
        warn("Side question not started", failureMessage(forked));
      }
      return false;
    }
    const targetRef = scopeThreadRef(input.environmentId, targetThreadId);
    if (!(await waitForThreadShell(targetRef))) {
      return warn(
        "Side question not opened",
        "It was created, but its data did not reach this client. Reconnect and try again.",
      );
    }
    const started = await startThreadTurn({
      environmentId: input.environmentId,
      input: {
        threadId: targetThreadId,
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
