import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  threadRuntimeCanArchive,
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { MessageCircleQuestion, MessageSquare } from "lucide-react";

import { cn } from "~/lib/utils";
import { useQuietThreadShells } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { PanelTabCloseButton } from "../ui/panel-tab-close-button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { openSideQuestions, sideQuestionMainThreadId } from "./sideQuestions.logic";

const tabClassName = (active: boolean) =>
  cn(
    "group/tab flex h-6 max-w-48 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs",
    active
      ? "bg-accent text-foreground"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  );

/** The main thread and its open `/btw` side questions, shown only while one is open. */
export function SideQuestionTabs(props: {
  readonly environmentId: EnvironmentId;
  readonly activeThreadId: ThreadId;
}) {
  const navigate = useNavigate();
  const archiveThread = useOrchestrationCommand(threadEnvironment.archive, {
    reportFailure: false,
  });
  const threads = useQuietThreadShells().filter(
    (thread) => thread.environmentId === props.environmentId,
  );
  const mainThreadId = sideQuestionMainThreadId(props.activeThreadId, threads);
  const sideQuestions = openSideQuestions(mainThreadId, threads);
  if (sideQuestions.length === 0) return null;
  const mainThread = threads.find((thread) => thread.id === mainThreadId);

  const open = (threadId: ThreadId) =>
    navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(props.environmentId, threadId)),
    });
  const close = async (sideQuestion: EnvironmentThreadShell) => {
    if (!threadRuntimeCanArchive(sideQuestion.runtime)) {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Side question is still answering",
          description: "Stop it before closing its tab.",
        }),
      );
      return;
    }
    if (sideQuestion.id === props.activeThreadId) await open(mainThreadId);
    const result = await archiveThread({
      environmentId: props.environmentId,
      input: { threadId: sideQuestion.id },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not close the side question",
          description: error instanceof Error ? error.message : "Try again.",
        }),
      );
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Side questions"
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-3 py-1 sm:px-5"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mainThreadId === props.activeThreadId}
        className={tabClassName(mainThreadId === props.activeThreadId)}
        onClick={() => void open(mainThreadId)}
      >
        <MessageSquare className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{mainThread?.title ?? "Main thread"}</span>
      </button>
      {sideQuestions.map((sideQuestion) => {
        const active = sideQuestion.id === props.activeThreadId;
        return (
          <div key={sideQuestion.id} className={tabClassName(active)}>
            <PanelTabCloseButton
              label={`Close ${sideQuestion.title}`}
              onClick={() => void close(sideQuestion)}
            >
              <MessageCircleQuestion className="size-3" aria-hidden />
              {threadRuntimeIsActive(sideQuestion.runtime) ? (
                <span
                  className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-current"
                  aria-hidden
                />
              ) : null}
            </PanelTabCloseButton>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="flex min-w-0 cursor-pointer items-center"
              onClick={() => void open(sideQuestion.id)}
            >
              <span className="truncate">{sideQuestion.title}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
