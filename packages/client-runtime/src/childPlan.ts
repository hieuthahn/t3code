import type { OrchestrationV2TurnItem, ThreadId, TurnItemId } from "@t3tools/contracts";

export type ChildPlanItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "child_plan_request" }
>;

export type ChildPlanDisplay =
  | { readonly kind: "pending" }
  | { readonly kind: "pending-elsewhere"; readonly label: string }
  | { readonly kind: "decided"; readonly label: string }
  | { readonly kind: "closed"; readonly label: string };

export type ChildPlanChildState =
  | { readonly state: "proposed" }
  | { readonly state: "starting" }
  | { readonly state: "started"; readonly childThreadId?: ThreadId }
  | { readonly state: "failed"; readonly failure: string }
  | { readonly state: "declined" };

/** Where one proposed child stands: picked and launched, picked and failed, or left out. */
export function childPlanChildState(
  item: Pick<ChildPlanItem, "planDecision" | "launches">,
  key: string,
): ChildPlanChildState {
  if (item.planDecision === null) return { state: "proposed" };
  if (!item.planDecision.approvedKeys.includes(key)) return { state: "declined" };
  const launch = item.launches?.find((candidate) => candidate.key === key);
  if (launch === undefined) return { state: "starting" };
  if (launch.failure !== undefined) return { state: "failed", failure: launch.failure };
  return launch.childThreadId === undefined
    ? { state: "started" }
    : { state: "started", childThreadId: launch.childThreadId };
}

export function childPlanDisplay(
  item: Pick<
    ChildPlanItem,
    "planStatus" | "planDecision" | "launches" | "children" | "closedReason"
  >,
  visibility: "local" | "inherited" | "synthetic",
): ChildPlanDisplay {
  switch (item.planStatus) {
    case "pending":
      return visibility === "local"
        ? { kind: "pending" }
        : { kind: "pending-elsewhere", label: "Waiting for a decision in the original thread" };
    case "expired":
      return { kind: "closed", label: "Expired before a decision" };
    case "cancelled":
      return { kind: "closed", label: item.closedReason ?? "Closed before a decision" };
    case "declined":
      return { kind: "decided", label: "Declined" };
    case "approved":
    case "partially_approved":
      return { kind: "decided", label: decidedLabel(item) };
  }
}

function decidedLabel(item: Pick<ChildPlanItem, "planDecision" | "launches" | "children">): string {
  const counts = { started: 0, starting: 0, failed: 0, declined: 0, proposed: 0 };
  for (const child of item.children) counts[childPlanChildState(item, child.key).state] += 1;
  return [
    counts.starting > 0 ? `Starting ${counts.starting}` : null,
    counts.started > 0 ? `${counts.started} started` : null,
    counts.failed > 0 ? `${counts.failed} failed` : null,
    counts.declined > 0 ? `${counts.declined} declined` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/** Build the decision for the picked keys, in the proposal's order and at its revision. */
export function childPlanDecideInput(
  item: Pick<ChildPlanItem, "id" | "threadId" | "revision" | "children">,
  pickedKeys: ReadonlyArray<string>,
): {
  readonly threadId: ThreadId;
  readonly turnItemId: TurnItemId;
  readonly revision: number;
  readonly approvedKeys: ReadonlyArray<string>;
} {
  return {
    threadId: item.threadId,
    turnItemId: item.id,
    revision: item.revision,
    approvedKeys: item.children.map((child) => child.key).filter((key) => pickedKeys.includes(key)),
  };
}
