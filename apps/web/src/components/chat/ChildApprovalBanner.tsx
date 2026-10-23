import {
  AuthOrchestrationOperateScope,
  type ProviderApprovalDecision,
  type RuntimeRequestId,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { derivePendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import { ShieldIcon } from "lucide-react";
import { useState } from "react";

import { derivePendingApprovals } from "../../session-logic";
import { useThreadProjection } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button, InlineButton } from "../ui/button";
import { ComposerBanner } from "./ComposerBanner";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";

/**
 * A subagent's oldest pending approval, answered from its parent's composer. The
 * answer goes to the subagent's own thread, where the server records it as the user's.
 */
export function ChildApprovalBanner({
  child,
  onOpenThread,
}: {
  readonly child: EnvironmentThreadShell;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const projection =
    useThreadProjection(scopeThreadRef(child.environmentId, child.id))?.projection ?? null;
  const canOperate = useEnvironmentScope(child.environmentId, AuthOrchestrationOperateScope);
  const respondToApproval = useOrchestrationCommand(threadEnvironment.respondToApproval);
  const [respondingRequestId, setRespondingRequestId] = useState<RuntimeRequestId | null>(null);
  const approvals =
    projection === null
      ? []
      : derivePendingApprovals(derivePendingThreadRequests(projection).approvals);
  const approval = approvals[0];

  const onRespondToApproval = async (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  ) => {
    setRespondingRequestId(requestId);
    await respondToApproval({
      environmentId: child.environmentId,
      input: { threadId: child.id, requestId, decision },
    });
    setRespondingRequestId(null);
  };
  const childLink = (
    <InlineButton tone="muted" onClick={() => onOpenThread(child.id)}>
      {child.title}
    </InlineButton>
  );

  return (
    <ComposerBanner.Row layout="approval">
      <ComposerBanner.Icon>
        <ShieldIcon />
      </ComposerBanner.Icon>
      <ComposerBanner.Content>
        <span className="flex min-w-0 flex-col items-start gap-1">
          <span className="min-w-0 truncate text-2xs text-muted-foreground">
            Subagent {childLink} needs approval
          </span>
          {approval ? (
            <ComposerPendingApprovalPanel approval={approval} pendingCount={approvals.length} />
          ) : null}
        </span>
      </ComposerBanner.Content>
      <ComposerBanner.Actions>
        {approval ? (
          <ComposerPendingApprovalActions
            requestId={approval.requestId}
            disabled={!canOperate}
            isResponding={respondingRequestId === approval.requestId}
            options={approval.options}
            canRespond={approval.responseCapability === "live"}
            onRespondToApproval={onRespondToApproval}
          />
        ) : (
          <Button size="xs" variant="ghost" onClick={() => onOpenThread(child.id)}>
            Open approval
          </Button>
        )}
      </ComposerBanner.Actions>
    </ComposerBanner.Row>
  );
}
