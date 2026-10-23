import type { OrchestrationV2TurnItem, ProviderApprovalDecision } from "@t3tools/contracts";

type RequestItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "approval_request" | "user_input_request" }
>;

const DECISION_LABELS: Record<ProviderApprovalDecision, string> = {
  accept: "Approved",
  acceptForSession: "Approved for this session",
  acceptAlways: "Always allowed",
  decline: "Declined",
  cancel: "Cancelled",
};

function decidedByPhrase(decidedBy: RequestItem["decidedBy"]): string {
  if (decidedBy === undefined) return "";
  return decidedBy.actor === "user" ? " by you" : " by an agent";
}

/** Labels an answered approval or question with who answered it; null while it waits. */
export function requestResolutionLabel(item: RequestItem): string | null {
  if (item.type === "approval_request") {
    if (item.decision === undefined) return null;
    return `${DECISION_LABELS[item.decision]}${decidedByPhrase(item.decidedBy)}`;
  }
  if (item.questionAnswer === undefined) return null;
  return item.decidedBy === undefined
    ? "Answered questions"
    : `Answered${decidedByPhrase(item.decidedBy)}`;
}
