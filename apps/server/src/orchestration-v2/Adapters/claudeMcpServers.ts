import type { OrchestrationV2McpServerStatus } from "@t3tools/contracts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const STATUS_BY_CLAUDE_STATUS: Readonly<Record<string, OrchestrationV2McpServerStatus["status"]>> =
  {
    connected: "connected",
    failed: "failed",
    "needs-auth": "needs_auth",
    pending: "pending",
    disabled: "disabled",
  };

/** Servers from the session `init` frame, or null for any other frame. Error text is left out because it can echo header credentials. */
export function claudeMcpServersFromInit(
  message: Pick<SDKMessage, "type"> & { readonly subtype?: string; readonly mcp_servers?: unknown },
): ReadonlyArray<OrchestrationV2McpServerStatus> | null {
  if (message.type !== "system" || message.subtype !== "init") return null;
  const servers = Array.isArray(message.mcp_servers) ? message.mcp_servers : [];
  return servers.flatMap((server: { readonly name: string; readonly status: string }) => {
    const status = STATUS_BY_CLAUDE_STATUS[server.status];
    return status === undefined ? [] : [{ name: server.name, status }];
  });
}
