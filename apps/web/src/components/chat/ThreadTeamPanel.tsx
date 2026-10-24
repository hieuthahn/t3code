import { useAtomValue } from "@effect/atom-react";
import { PauseIcon, PlayIcon, SquareIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type TeamAssignmentView,
  type ThreadId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
} from "./threadDetailsPanelStyles";
import { TEAM_RUN_STATUS_TEXT, teamAssignmentStatusText, teamUsageText } from "./teamWaitText";

const STATUS_DOT_CLASS: Record<TeamAssignmentView["status"], string> = {
  waiting: "bg-muted-foreground/40",
  running: "bg-sky-500",
  done: "bg-emerald-500",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground/40",
};

type TeamAction = "pause" | "resume" | "stop";

const ACTION_FAILURE_TITLE: Record<TeamAction, string> = {
  pause: "Could not pause the team",
  resume: "Could not resume the team",
  stop: "Could not stop the team",
};

/** The thread's team run: what each assignment does or waits for, with Pause, Resume and Stop. */
export function ThreadTeamPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const canOperate = useAtomValue(serverEnvironment.pauseTeam.permissionAtom(props.environmentId));
  const teamQuery = useEnvironmentQuery(
    serverEnvironment.teamLive({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    }),
  );
  const commands = {
    pause: useAtomCommand(serverEnvironment.pauseTeam, { label: "team pause" }),
    resume: useAtomCommand(serverEnvironment.resumeTeam, { label: "team resume" }),
    stop: useAtomCommand(serverEnvironment.stopTeam, { label: "team stop" }),
  };
  const [busy, setBusy] = useState(false);
  const run = teamQuery.data ?? null;

  if (teamQuery.error === null && run === null) return null;

  const act = async (action: TeamAction) => {
    if (busy || !readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope)) return;
    setBusy(true);
    const result = await commands[action]({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: ACTION_FAILURE_TITLE[action],
          description: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };
  const open = run !== null && run.status !== "stopped" && run.status !== "finished";
  const controls =
    run === null || !open ? undefined : (
      <>
        {run.status === "running" ? (
          <ThreadDetailsControl
            part="meta"
            aria-label="Pause the team"
            disabled={!canOperate || busy}
            onClick={() => void act("pause")}
          >
            <PauseIcon className="size-3" aria-hidden />
            Pause
          </ThreadDetailsControl>
        ) : null}
        {run.status === "paused" || run.status === "interrupted" ? (
          <ThreadDetailsControl
            part="meta"
            tone="primary"
            aria-label="Resume the team"
            disabled={!canOperate || busy}
            onClick={() => void act("resume")}
          >
            <PlayIcon className="size-3" aria-hidden />
            Resume
          </ThreadDetailsControl>
        ) : null}
        <ThreadDetailsControl
          part="meta"
          aria-label="Stop the team"
          disabled={!canOperate || busy}
          onClick={() => void act("stop")}
        >
          <SquareIcon className="size-3" aria-hidden />
          Stop
        </ThreadDetailsControl>
      </>
    );

  return (
    <ThreadDetailsSection
      headingId="thread-details-team-heading"
      title="Team"
      actions={controls}
      data-thread-team-panel
    >
      {teamQuery.error !== null ? (
        <p className="px-2.5 py-1.5 text-2xs text-destructive">
          Could not load the team: {teamQuery.error}
        </p>
      ) : null}
      {run === null ? null : (
        <>
          <div
            className={cn(
              "flex items-center gap-1.5 py-1.5",
              THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
            )}
          >
            <UsersIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground/80">
                {TEAM_RUN_STATUS_TEXT[run.status]}
              </span>
              <p className="truncate text-2xs text-muted-foreground">{teamUsageText(run)}</p>
            </div>
          </div>
          {run.summary === null ? null : (
            <p className="px-2.5 pb-1.5 text-2xs text-muted-foreground">{run.summary}</p>
          )}
          {run.report === null ? null : (
            <p role="status" className="px-2.5 pb-1.5 text-2xs text-warning-foreground">
              {run.report}
            </p>
          )}
          <ul className="m-0 list-none p-0">
            {run.assignments.map((assignment) => (
              <li
                key={assignment.key}
                data-team-assignment-status={assignment.status}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg py-1",
                  THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
                )}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    STATUS_DOT_CLASS[assignment.status],
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground/80">
                    {assignment.title}
                  </span>
                  <p
                    className={cn(
                      "text-2xs break-words",
                      assignment.status === "failed" ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {assignment.key} · {assignment.model} · {teamAssignmentStatusText(assignment)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </ThreadDetailsSection>
  );
}
