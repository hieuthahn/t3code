import type { OrchestrationV2McpServerStatus } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
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
  pending: { label: "Connecting", dotClass: "bg-muted-foreground/40", textClass: "text-muted-foreground" },
  disabled: { label: "Off", dotClass: "bg-muted-foreground/40", textClass: "text-muted-foreground" },
};

/** MCP servers this thread's provider session reported. Renders nothing when there are none. */
export function ThreadConnectorsPanel(props: {
  readonly servers: ReadonlyArray<OrchestrationV2McpServerStatus>;
}) {
  if (props.servers.length === 0) return null;
  return (
    <ThreadDetailsSection
      headingId="thread-details-connectors-heading"
      title="Connectors"
      data-thread-connectors-panel
    >
      <ul className="m-0 flex max-h-40 list-none flex-col overflow-y-auto p-0">
        {props.servers.map((server) => {
          const presentation = STATUS_PRESENTATION[server.status];
          return (
            <li
              key={server.name}
              data-mcp-server-status={server.status}
              className={cn("flex items-center gap-2 py-1", THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS)}
            >
              <span
                className={cn("size-1.5 shrink-0 rounded-full", presentation.dotClass)}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground/80">
                {server.name}
              </span>
              <span className={cn("shrink-0 text-2xs", presentation.textClass)}>
                {presentation.label}
              </span>
            </li>
          );
        })}
      </ul>
    </ThreadDetailsSection>
  );
}
