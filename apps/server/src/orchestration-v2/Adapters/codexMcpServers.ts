import type { OrchestrationV2McpServerStatus } from "@t3tools/contracts";

type McpServerState = OrchestrationV2McpServerStatus["status"];

const STATE_BY_STARTUP_STATUS: Readonly<Record<string, McpServerState>> = {
  starting: "pending",
  ready: "connected",
  failed: "failed",
};

/** A cancelled startup is superseded by the restart that follows it, so it drops the entry. */
export function applyCodexMcpStartupStatus(
  statuses: Map<string, McpServerState>,
  name: string,
  startupStatus: string,
): void {
  const state = STATE_BY_STARTUP_STATUS[startupStatus];
  if (state === undefined) statuses.delete(name);
  else statuses.set(name, state);
}

export function codexMcpServersFromStartupStatuses(
  statuses: ReadonlyMap<string, McpServerState>,
): ReadonlyArray<OrchestrationV2McpServerStatus> {
  return [...statuses].map(([name, status]) => ({ name, status }));
}

export function codexMcpServersEqual(
  left: ReadonlyArray<OrchestrationV2McpServerStatus>,
  right: ReadonlyArray<OrchestrationV2McpServerStatus>,
): boolean {
  return (
    left.length === right.length &&
    left.every((server, index) => {
      const other = right[index];
      return other !== undefined && server.name === other.name && server.status === other.status;
    })
  );
}
