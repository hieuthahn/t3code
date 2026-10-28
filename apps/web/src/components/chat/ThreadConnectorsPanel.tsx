import type { EnvironmentId, OrchestrationV2McpServerStatus, ThreadId } from "@t3tools/contracts";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { useQuietThreadVisibleTurnItems } from "../../state/entities";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { createThreadConnectorsSelector } from "./threadConnectors.logic";
import { THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS } from "./threadDetailsPanelStyles";

const STATUS_PRESENTATION: Record<
  OrchestrationV2McpServerStatus["status"],
  { readonly label: string; readonly dotClass: string; readonly textClass: string }
> = {
  connected: { label: "Connected", dotClass: "bg-emerald-500", textClass: "text-muted-foreground" },
  failed: { label: "Failed", dotClass: "bg-destructive", textClass: "text-destructive" },
  needs_auth: {
    label: "Needs sign-in",
    dotClass: "bg-amber-500",
    textClass: "text-warning-foreground",
  },
  pending: {
    label: "Connecting",
    dotClass: "bg-muted-foreground/40",
    textClass: "text-muted-foreground",
  },
  disabled: {
    label: "Off",
    dotClass: "bg-muted-foreground/40",
    textClass: "text-muted-foreground",
  },
};

const ATTENTION_STATUSES: ReadonlySet<OrchestrationV2McpServerStatus["status"]> = new Set([
  "failed",
  "needs_auth",
]);

function ConnectorRows(props: {
  readonly servers: ReadonlyArray<OrchestrationV2McpServerStatus>;
  readonly muted?: boolean;
}) {
  return (
    <ul className="m-0 flex max-h-40 list-none flex-col overflow-y-auto p-0">
      {props.servers.map((server) => {
        const presentation = STATUS_PRESENTATION[server.status];
        const needsAttention = ATTENTION_STATUSES.has(server.status);
        return (
          <li
            key={server.name}
            data-mcp-server-status={server.status}
            {...(needsAttention ? { "data-mcp-server-attention": "" } : {})}
            className={cn("flex items-center gap-2 py-1", THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS)}
          >
            <span
              className={cn("size-1.5 shrink-0 rounded-full", presentation.dotClass)}
              aria-hidden
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                needsAttention
                  ? "font-medium text-foreground"
                  : props.muted
                    ? "text-muted-foreground"
                    : "text-foreground/80",
              )}
            >
              {server.name}
            </span>
            <span
              className={cn(
                "shrink-0 text-2xs",
                needsAttention && "font-medium",
                presentation.textClass,
              )}
            >
              {presentation.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The MCP servers this thread called or asked to call, with their status.
 * The rest of the session's servers sit behind "Show all". Renders nothing without servers.
 */
export function ThreadConnectorsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly servers: ReadonlyArray<OrchestrationV2McpServerStatus>;
}) {
  const [select] = useState(createThreadConnectorsSelector);
  const [expanded, setExpanded] = useState(false);
  const rows = useQuietThreadVisibleTurnItems(
    props.servers.length === 0
      ? null
      : { environmentId: props.environmentId, threadId: props.threadId },
  );
  if (props.servers.length === 0) return null;
  const { used, unused } = select(props.servers, rows);
  return (
    <ThreadDetailsSection
      headingId="thread-details-connectors-heading"
      title="Connectors"
      data-thread-connectors-panel
    >
      {used.length > 0 ? <ConnectorRows servers={used} /> : null}
      {unused.length > 0 ? (
        <>
          {expanded ? <ConnectorRows servers={unused} muted /> : null}
          <ThreadDetailsControl
            part="meta"
            className="ml-2.5 mt-1"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Show fewer" : `Show all (${props.servers.length})`}
          </ThreadDetailsControl>
        </>
      ) : null}
    </ThreadDetailsSection>
  );
}
