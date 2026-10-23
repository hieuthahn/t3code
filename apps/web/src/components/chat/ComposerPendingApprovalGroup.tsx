import { pendingApprovalBulkTargets } from "@t3tools/client-runtime/state/thread-requests";
import type { ProviderApprovalDecision, RuntimeRequestId } from "@t3tools/contracts";
import { ShieldIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import { type PendingApproval } from "../../session-logic";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerBanner } from "./ComposerBanner";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";

interface ComposerPendingApprovalGroupProps {
  approvals: ReadonlyArray<PendingApproval>;
  respondingRequestIds: ReadonlyArray<RuntimeRequestId>;
  disabled: boolean;
  onRespondToApproval: (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

export function ComposerPendingApprovalGroup({
  approvals,
  respondingRequestIds,
  disabled,
  onRespondToApproval,
}: ComposerPendingApprovalGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const [bulkResponding, setBulkResponding] = useState(false);
  const listId = useId();
  const approveTargets = pendingApprovalBulkTargets(approvals, "accept");
  const denyTargets = pendingApprovalBulkTargets(approvals, "decline");
  const blocked = disabled || bulkResponding;

  // Each request goes through the same per-request call a single answer uses,
  // one at a time so the provider sees them in the order it asked.
  const respondToAll = async (
    requestIds: ReadonlyArray<RuntimeRequestId>,
    decision: "accept" | "decline",
  ) => {
    setBulkResponding(true);
    for (const requestId of requestIds) {
      if (respondingRequestIds.includes(requestId)) continue;
      await onRespondToApproval(requestId, decision);
    }
    setBulkResponding(false);
  };

  const approveAll = (
    <Button
      size="xs"
      variant="default"
      disabled={blocked || approveTargets.requestIds.length === 0}
      aria-description={approveTargets.warnings.join(" ") || undefined}
      onClick={() => void respondToAll(approveTargets.requestIds, "accept")}
    >
      {approveTargets.warnings.length > 0 ? (
        <TriangleAlertIcon className="size-3 shrink-0" />
      ) : null}
      Approve all
    </Button>
  );

  return (
    <div role="group" aria-label={`${approvals.length} pending approvals`} className="grid gap-3">
      <ComposerBanner.Row layout="approval" data-chat-composer-collapsed-controls="true">
        <ComposerBanner.Icon>
          <ShieldIcon />
        </ComposerBanner.Icon>
        <ComposerBanner.Content>
          <Button
            size="xs"
            variant="ghost"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((value) => !value)}
          >
            <span className="font-medium text-warning tabular-nums">
              {approvals.length} approvals
            </span>
            <ComposerBanner.ToggleIcon expanded={expanded} />
          </Button>
        </ComposerBanner.Content>
        <ComposerBanner.Actions>
          <Button
            size="xs"
            variant="outline"
            disabled={blocked || denyTargets.requestIds.length === 0}
            onClick={() => void respondToAll(denyTargets.requestIds, "decline")}
          >
            Deny all
          </Button>
          {approveTargets.warnings.length > 0 ? (
            <Tooltip>
              <TooltipTrigger render={approveAll} />
              <TooltipPopup side="top" className="max-w-80 whitespace-normal">
                {approveTargets.warnings.join(" ")}
              </TooltipPopup>
            </Tooltip>
          ) : (
            approveAll
          )}
        </ComposerBanner.Actions>
      </ComposerBanner.Row>
      {expanded ? (
        <ol id={listId} className="grid max-h-80 gap-3 overflow-y-auto">
          {approvals.map((approval) => (
            <ComposerBanner.Row
              key={approval.requestId}
              render={<li />}
              layout="approval"
              className="border-t border-warning/20 pt-3"
            >
              <ComposerBanner.Icon />
              <ComposerBanner.Content>
                <ComposerPendingApprovalPanel approval={approval} pendingCount={1} />
              </ComposerBanner.Content>
              <ComposerBanner.Actions>
                <ComposerPendingApprovalActions
                  requestId={approval.requestId}
                  disabled={blocked}
                  isResponding={respondingRequestIds.includes(approval.requestId)}
                  options={approval.options}
                  canRespond={approval.responseCapability === "live"}
                  onRespondToApproval={onRespondToApproval}
                />
              </ComposerBanner.Actions>
            </ComposerBanner.Row>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
