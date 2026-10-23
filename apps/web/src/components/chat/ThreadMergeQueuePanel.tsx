import { useAtomValue } from "@effect/atom-react";
import { TriangleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type MergeQueueItem,
  type ThreadId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { cn } from "../../lib/utils";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
} from "./threadDetailsPanelStyles";

const STATUS_DOT_CLASS: Record<MergeQueueItem["status"], string> = {
  awaiting_user: "bg-warning",
  queued: "bg-muted-foreground/40",
  updating: "bg-sky-500",
  gating: "bg-sky-500",
  merging: "bg-sky-500",
  merged: "bg-emerald-500",
  failed: "bg-destructive",
  cancelled: "bg-muted-foreground/40",
};

const FAILURE_LABEL: Record<NonNullable<MergeQueueItem["failure"]>["stage"], string> = {
  head_moved: "new commits since approval",
  update: "could not update",
  gate: "gate failed",
  merge: "could not land",
  interrupted: "interrupted by a restart",
};

const REMOVABLE_STATUSES: ReadonlySet<MergeQueueItem["status"]> = new Set([
  "awaiting_user",
  "queued",
  "failed",
]);

function statusLabel(item: MergeQueueItem, trunkRef: string) {
  switch (item.status) {
    case "awaiting_user":
      return `waiting for approval at ${item.headShaAtEnqueue.slice(0, 7)}`;
    case "queued":
      return "queued";
    case "updating":
      return `merging ${trunkRef} in`;
    case "gating":
      return "running gates";
    case "merging":
      return "landing";
    case "merged":
      return "merged";
    case "failed":
      return item.failure === null ? "failed" : FAILURE_LABEL[item.failure.stage];
    case "cancelled":
      return "removed";
  }
}

export function ThreadMergeQueuePanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const canOperate = useAtomValue(
    serverEnvironment.approveMergeQueueItem.permissionAtom(props.environmentId),
  );
  const queueQuery = useEnvironmentQuery(
    serverEnvironment.mergeQueueLive({
      environmentId: props.environmentId,
      input: { ownerThreadId: props.threadId },
    }),
  );
  const approveItem = useAtomCommand(serverEnvironment.approveMergeQueueItem, {
    label: "merge queue approve",
  });
  const cancelItem = useAtomCommand(serverEnvironment.cancelMergeQueueItem, {
    label: "merge queue cancel",
  });
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  const items = (queueQuery.data?.items ?? []).filter((item) => item.status !== "cancelled");
  const movedTrunks = (queueQuery.data?.trunks ?? []).filter((trunk) => trunk.movedOutsideQueue);

  if (queueQuery.error === null && items.length === 0) return null;

  const decide = async (item: MergeQueueItem, decision: "approve" | "cancel") => {
    if (
      busyItemId !== null ||
      !readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    setBusyItemId(item.id);
    const result =
      decision === "approve"
        ? await approveItem({
            environmentId: props.environmentId,
            input: { itemId: item.id, headSha: item.headShaAtEnqueue },
          })
        : await cancelItem({ environmentId: props.environmentId, input: { itemId: item.id } });
    setBusyItemId(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: decision === "approve" ? "Could not approve the merge" : "Could not remove it",
          description: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };

  return (
    <ThreadDetailsSection
      headingId="thread-details-merge-queue-heading"
      title="Merge queue"
      data-thread-merge-queue-panel
    >
      {queueQuery.error !== null ? (
        <p className="px-2.5 py-1.5 text-2xs text-destructive">
          Could not load the merge queue: {queueQuery.error}
        </p>
      ) : null}

      {movedTrunks.map((trunk) => (
        <p
          key={trunk.trunkRef}
          role="status"
          className="flex items-start gap-1.5 px-2.5 py-1.5 text-2xs text-warning-foreground"
        >
          <TriangleAlertIcon className="mt-px size-3 shrink-0" aria-hidden />
          {trunk.trunkRef} changed outside the queue. Gates run on what is there now.
        </p>
      ))}

      <ul className="m-0 list-none p-0">
        {items.map((item) => (
          <li
            key={item.id}
            data-merge-queue-status={item.status}
            className={cn(
              "group flex items-center rounded-lg py-1.5",
              THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
            )}
          >
            <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
              <PullRequestGlyph.merged className={THREAD_DETAILS_PANEL_ICON_CLASS} />
              <span
                className={cn(
                  "absolute -right-1 -top-1 size-1.5 rounded-full",
                  STATUS_DOT_CLASS[item.status],
                )}
                aria-hidden
              />
            </span>
            <Tooltip>
              <TooltipTrigger render={<div className="min-w-0 flex-1" />}>
                <span className="block truncate text-sm font-medium text-foreground/80">
                  {item.childTitle}
                </span>
                <p
                  className={cn(
                    "truncate text-2xs",
                    item.status === "failed" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {item.childBranch} · {statusLabel(item, item.trunkRef)}
                </p>
              </TooltipTrigger>
              <TooltipPopup side="left" className="max-w-80">
                <p className="font-medium">
                  {item.childBranch} into {item.trunkRef}
                </p>
                {item.failure !== null ? (
                  <p className="whitespace-pre-wrap break-words text-muted-foreground">
                    {item.failure.message}
                  </p>
                ) : (
                  <p className="text-muted-foreground">{statusLabel(item, item.trunkRef)}</p>
                )}
              </TooltipPopup>
            </Tooltip>
            {item.status === "awaiting_user" ? (
              <ThreadDetailsControl
                part="meta"
                tone="primary"
                aria-label={`Approve merging ${item.childTitle} at ${item.headShaAtEnqueue.slice(0, 7)}`}
                disabled={!canOperate || busyItemId !== null}
                onClick={() => void decide(item, "approve")}
              >
                Approve
              </ThreadDetailsControl>
            ) : null}
            {REMOVABLE_STATUSES.has(item.status) ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ThreadDetailsControl
                      size="icon-xs"
                      variant="ghost"
                      part="icon"
                      aria-label={`Remove ${item.childTitle} from the merge queue`}
                      disabled={!canOperate || busyItemId !== null}
                      onClick={() => void decide(item, "cancel")}
                    >
                      <XIcon className="size-3.5" />
                    </ThreadDetailsControl>
                  }
                />
                <TooltipPopup>Remove from queue</TooltipPopup>
              </Tooltip>
            ) : null}
          </li>
        ))}
      </ul>
    </ThreadDetailsSection>
  );
}
