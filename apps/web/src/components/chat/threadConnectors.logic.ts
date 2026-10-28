import type { ThreadStructureTurnItem } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2McpServerStatus } from "@t3tools/contracts";

type ConnectorServer = OrchestrationV2McpServerStatus;

export interface ThreadConnectorRow {
  readonly item: ThreadStructureTurnItem;
}

export interface ThreadConnectors {
  readonly used: ReadonlyArray<ConnectorServer>;
  readonly unused: ReadonlyArray<ConnectorServer>;
}

const CLAUDE_AI_PREFIX = "claude_ai_";
const T3_SERVER = "t3_code";
const MCP_SOURCE_KEY_PREFIX = "mcp:";
const CLAUDE_TOOL_NAME = /^mcp__(.+?)__(.+)$/iu;
const CODEX_TOOL_NAME = /^([^.]+)\.(.+)$/u;

const EMPTY_SERVERS: ReadonlyArray<ConnectorServer> = Object.freeze([]);
const EMPTY_CONNECTORS: ThreadConnectors = Object.freeze({
  used: EMPTY_SERVERS,
  unused: EMPTY_SERVERS,
});

/** Fold a server name or tool prefix to one key, so "claude.ai Google Drive" meets `claude_ai_Google_Drive`. */
export function normalizeConnectorName(value: string): string {
  const key = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return key.startsWith(CLAUDE_AI_PREFIX) ? key.slice(CLAUDE_AI_PREFIX.length) : key;
}

function toolNameServer(toolName: string | null): string | null {
  if (toolName === null) return null;
  return (CLAUDE_TOOL_NAME.exec(toolName) ?? CODEX_TOOL_NAME.exec(toolName))?.[1] ?? null;
}

function itemServerNames(item: ThreadStructureTurnItem): ReadonlyArray<string> {
  if (item.type !== "dynamic_tool" && item.type !== "approval_request") return [];
  const names: string[] = [];
  const source = item.toolSource;
  if (source?.key.toLowerCase().startsWith(MCP_SOURCE_KEY_PREFIX)) {
    names.push(source.key.slice(MCP_SOURCE_KEY_PREFIX.length), source.name);
  }
  if (item.type === "dynamic_tool") {
    const fromToolName = toolNameServer(item.toolName);
    if (fromToolName !== null) names.push(fromToolName);
  } else if (item.appName !== undefined) {
    names.push(item.appName);
  }
  return names;
}

function usedServerKeys(rows: ReadonlyArray<ThreadConnectorRow>): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const { item } of rows) {
    for (const name of itemServerNames(item)) {
      const key = normalizeConnectorName(name);
      if (key !== "" && key !== T3_SERVER) keys.add(key);
    }
  }
  return keys;
}

function sameServers(
  left: ReadonlyArray<ConnectorServer>,
  right: ReadonlyArray<ConnectorServer>,
): boolean {
  return (
    left === right ||
    (left.length === right.length &&
      left.every(
        (server, index) =>
          server.name === right[index]!.name && server.status === right[index]!.status,
      ))
  );
}

/**
 * Split the session's servers into those a thread item names (any status) and the rest.
 * Returns `previous`, or its unchanged group, when the result is equal.
 */
export function deriveThreadConnectors(
  servers: ReadonlyArray<ConnectorServer>,
  rows: ReadonlyArray<ThreadConnectorRow>,
  previous: ThreadConnectors = EMPTY_CONNECTORS,
): ThreadConnectors {
  if (servers.length === 0) return EMPTY_CONNECTORS;
  const keys = usedServerKeys(rows);
  const used = servers.filter((server) => keys.has(normalizeConnectorName(server.name)));
  const unused = servers.filter((server) => !used.includes(server));
  const stableUsed = sameServers(previous.used, used) ? previous.used : used;
  const stableUnused = sameServers(previous.unused, unused) ? previous.unused : unused;
  if (stableUsed === previous.used && stableUnused === previous.unused) return previous;
  return {
    used: stableUsed.length === 0 ? EMPTY_SERVERS : stableUsed,
    unused: stableUnused.length === 0 ? EMPTY_SERVERS : stableUnused,
  };
}

/** One selector per card instance; it keeps the last result so equal input yields the same reference. */
export function createThreadConnectorsSelector(): (
  servers: ReadonlyArray<ConnectorServer>,
  rows: ReadonlyArray<ThreadConnectorRow>,
) => ThreadConnectors {
  let lastServers: ReadonlyArray<ConnectorServer> | null = null;
  let lastRows: ReadonlyArray<ThreadConnectorRow> | null = null;
  let last = EMPTY_CONNECTORS;
  return (servers, rows) => {
    if (servers === lastServers && rows === lastRows) return last;
    last = deriveThreadConnectors(servers, rows, last);
    lastServers = servers;
    lastRows = rows;
    return last;
  };
}
