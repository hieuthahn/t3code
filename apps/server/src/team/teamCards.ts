import {
  CommandId,
  type OrchestrationV2ChildPlanLaunch,
  type OrchestrationV2TurnItem,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import type { TeamAssignmentRow } from "./teamRows.ts";
import type { NewTeamAssignment } from "./teamStore.ts";

export type TeamCard = Extract<OrchestrationV2TurnItem, { readonly type: "child_plan_request" }>;

type Threads = ThreadManagementService.ThreadManagementService["Service"];

/** The request key a team run's rounds share, so its cards can be told from other proposals. */
export const roundRequestPrefix = (runId: string) => `team:${runId}:round:`;

const planPrefix = (threadId: ThreadId, runId: string) =>
  `child-plan:${encodeURIComponent(threadId)}:${encodeURIComponent(roundRequestPrefix(runId))}`;

/** The cards a team run opened that wait after the architect's turn, oldest first. */
export const teamCardsOf = (threads: Threads, threadId: ThreadId, runId: string) =>
  threads
    .getThreadRecords(threadId, ["turnItems"], {
      turnItemTypes: ["child_plan_request"],
      messageRoles: [],
    })
    .pipe(
      Effect.map((records) =>
        records.turnItems.filter(
          (item): item is TeamCard =>
            item.type === "child_plan_request" &&
            item.waitsAfterRun === true &&
            item.planId.startsWith(planPrefix(threadId, runId)),
        ),
      ),
    );

/** Close an undecided card, keeping where it was asked. */
export const closeCard = (threads: Threads, card: TeamCard, reason: string) =>
  card.runId === null || card.nodeId === null || card.planStatus !== "pending"
    ? Effect.void
    : threads
        .dispatch({
          type: "child_plan.record",
          commandId: CommandId.make(`team:card:${card.id}:closed`),
          threadId: card.threadId,
          runId: card.runId,
          nodeId: card.nodeId,
          turnItemId: card.id,
          planId: card.planId,
          ...(card.reason === undefined ? {} : { reason: card.reason }),
          children: card.children,
          planStatus: "cancelled",
          closedReason: reason,
          waitsAfterRun: true,
        })
        .pipe(Effect.asVoid);

const launchesKey = (launches: ReadonlyArray<OrchestrationV2ChildPlanLaunch>) =>
  launches
    .map(
      (launch) => `${launch.key}=${launch.taskId ?? ""}:${launch.failure === undefined ? "" : "x"}`,
    )
    .join(",");

/** Show on the card what each approved assignment did; an empty list marks the round queued. */
export const recordLaunches = (
  threads: Threads,
  card: TeamCard,
  launches: ReadonlyArray<OrchestrationV2ChildPlanLaunch>,
) =>
  card.launches !== undefined && launchesKey(card.launches) === launchesKey(launches)
    ? Effect.void
    : threads
        .dispatch({
          type: "child_plan.launched",
          commandId: CommandId.make(
            `team:card:${card.id}:launched:${encodeURIComponent(launchesKey(launches))}`,
          ),
          threadId: card.threadId,
          turnItemId: card.id,
          launches,
        })
        .pipe(Effect.asVoid);

/** The approved children as team assignments, with the scheduling the architect gave them. */
export const approvedAssignments = (card: TeamCard): ReadonlyArray<NewTeamAssignment> => {
  const approved = new Set(card.planDecision?.approvedKeys ?? []);
  return card.children.flatMap((child) =>
    approved.has(child.key)
      ? [
          {
            key: child.key,
            title: child.title,
            task: child.brief,
            instanceId: child.modelSelection.instanceId,
            model: child.modelSelection.model,
            options: child.modelSelection.options ?? [],
            dependsOn: child.dependsOn ?? [],
            readOnly: child.readOnly ?? false,
            files: child.files ?? [],
            isolation: child.isolation,
          },
        ]
      : [],
  );
};

/** Each approved assignment that started or ended, as the card shows it. */
export const launchesFromRows = (
  card: TeamCard,
  rows: ReadonlyArray<TeamAssignmentRow>,
): ReadonlyArray<OrchestrationV2ChildPlanLaunch> =>
  (card.planDecision?.approvedKeys ?? []).flatMap((key): Array<OrchestrationV2ChildPlanLaunch> => {
    const row = rows.find((candidate) => candidate.assignment_key === key);
    if (row === undefined || row.status === "waiting") return [];
    if (row.status === "failed" || row.status === "cancelled") {
      return [
        {
          key,
          failure:
            row.failure ??
            `The assignment ${row.status === "failed" ? "failed" : "was cancelled"}.`,
        },
      ];
    }
    if (row.task_id === null) return [];
    return [
      {
        key,
        taskId: row.task_id,
        ...(row.child_thread_id === null ? {} : { childThreadId: row.child_thread_id }),
      },
    ];
  });
