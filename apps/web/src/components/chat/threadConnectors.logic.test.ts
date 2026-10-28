import type { OrchestrationV2McpServerStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createThreadConnectorsSelector,
  deriveThreadConnectors,
  normalizeConnectorName,
  type ThreadConnectorRow,
} from "./threadConnectors.logic";

type Server = OrchestrationV2McpServerStatus;

const server = (name: string, status: Server["status"] = "connected"): Server => ({
  name,
  status,
});

const row = (item: Record<string, unknown>): ThreadConnectorRow =>
  ({ item: { status: "completed", ...item } }) as unknown as ThreadConnectorRow;

const tool = (toolName: string | null, extra: Record<string, unknown> = {}) =>
  row({ type: "dynamic_tool", toolName, ...extra });

const usedNames = (servers: ReadonlyArray<Server>, rows: ReadonlyArray<ThreadConnectorRow>) =>
  deriveThreadConnectors(servers, rows).used.map((entry) => entry.name);

describe("normalizeConnectorName", () => {
  it("lowercases, maps non-alphanumerics to underscores and drops a claude_ai_ prefix", () => {
    expect(normalizeConnectorName("claude.ai Google Drive")).toBe("google_drive");
    expect(normalizeConnectorName("claude_ai_Google_Drive")).toBe("google_drive");
    expect(normalizeConnectorName("plugin:figma:figma")).toBe("plugin_figma_figma");
    expect(normalizeConnectorName("t3-code")).toBe("t3_code");
  });

  it("keeps a name that is only the prefix", () => {
    expect(normalizeConnectorName("claude.ai")).toBe("claude_ai");
  });
});

describe("deriveThreadConnectors", () => {
  const drive = server("claude.ai Google Drive");
  const firecrawl = server("claude.ai Firecrawl");
  const linear = server("linear");

  it("returns empty groups when the session reported no servers", () => {
    const result = deriveThreadConnectors([], [tool("mcp__linear__list_issues")]);
    expect(result.used).toEqual([]);
    expect(result.unused).toEqual([]);
  });

  it("leaves every server unused when the thread called none of them", () => {
    const result = deriveThreadConnectors(
      [drive, linear],
      [tool("Read"), row({ type: "assistant_message" }), tool(null)],
    );
    expect(result.used).toEqual([]);
    expect(result.unused).toEqual([drive, linear]);
  });

  it("matches the Claude mcp__server__tool name", () => {
    expect(usedNames([drive, linear], [tool("mcp__linear__list_issues")])).toEqual(["linear"]);
  });

  it("matches the Codex server.tool name", () => {
    expect(usedNames([drive, linear], [tool("linear.list_issues")])).toEqual(["linear"]);
  });

  it("matches the toolSource key before any tool name exists", () => {
    const result = usedNames(
      [firecrawl, linear],
      [tool(null, { toolSource: { key: "mcp:firecrawl", name: "claude.ai Firecrawl" } })],
    );
    expect(result).toEqual(["claude.ai Firecrawl"]);
  });

  it("matches a display name that differs from the tool prefix", () => {
    expect(usedNames([drive, linear], [tool("mcp__claude_ai_Google_Drive__search_files")])).toEqual(
      ["claude.ai Google Drive"],
    );
    expect(usedNames([firecrawl], [tool("mcp__firecrawl__scrape")])).toEqual([
      "claude.ai Firecrawl",
    ]);
  });

  it("counts a call in any status, including failed and awaiting approval", () => {
    const rows = [
      tool("mcp__linear__list_issues", { status: "failed" }),
      tool("mcp__claude_ai_Google_Drive__search_files", { status: "waiting" }),
    ];
    expect(usedNames([drive, linear, firecrawl], rows)).toEqual([
      "claude.ai Google Drive",
      "linear",
    ]);
  });

  it("counts an approval request that names a server by source or app name", () => {
    expect(
      usedNames(
        [drive, linear, firecrawl],
        [
          row({ type: "approval_request", toolSource: { key: "mcp:linear", name: "linear" } }),
          row({ type: "approval_request", appName: "claude.ai Firecrawl" }),
        ],
      ),
    ).toEqual(["linear", "claude.ai Firecrawl"]);
  });

  it("ignores approval requests that name no server", () => {
    expect(
      usedNames([linear], [row({ type: "approval_request", requestKind: "command" })]),
    ).toEqual([]);
  });

  it("keeps a used server that needs sign-in or failed, in the used group", () => {
    const needsAuth = server("linear", "needs_auth");
    const failed = server("claude.ai Firecrawl", "failed");
    const result = deriveThreadConnectors(
      [drive, needsAuth, failed],
      [tool("mcp__linear__list_issues"), tool("firecrawl.scrape")],
    );
    expect(result.used).toEqual([needsAuth, failed]);
    expect(result.unused).toEqual([drive]);
  });

  it("treats the t3-code server as unused in every name format", () => {
    const t3 = server("t3-code");
    const rows = [
      tool("mcp__t3-code__project_memory_append"),
      tool("t3-code.t3_thread_read"),
      tool("t3_thread_list"),
      tool(null, { toolSource: { key: "mcp:t3-code", name: "t3-code" } }),
    ];
    const result = deriveThreadConnectors([t3, linear], rows);
    expect(result.used).toEqual([]);
    expect(result.unused).toEqual([t3, linear]);
  });

  it("does not match a different server that shares a prefix", () => {
    expect(usedNames([server("linear")], [tool("mcp__linear_extra__go")])).toEqual([]);
  });

  it("reuses the previous result for equal input, and each unchanged group", () => {
    const rows = [tool("mcp__linear__list_issues")];
    const first = deriveThreadConnectors([drive, linear], rows);
    const again = deriveThreadConnectors(
      [{ ...drive }, { ...linear }],
      [tool("mcp__linear__list_issues")],
      first,
    );
    expect(again).toBe(first);

    const grown = deriveThreadConnectors(
      [drive, linear],
      [...rows, tool("mcp__claude_ai_Google_Drive__search")],
      first,
    );
    expect(grown).not.toBe(first);
    expect(grown.used).toHaveLength(2);

    const flipped = deriveThreadConnectors(
      [drive, server("linear", "failed")],
      [tool("mcp__linear__list_issues")],
      first,
    );
    expect(flipped.used).not.toBe(first.used);
    expect(flipped.unused).toBe(first.unused);
  });

  it("returns one shared empty result when there is nothing to show", () => {
    expect(deriveThreadConnectors([], [])).toBe(deriveThreadConnectors([], []));
  });
});

describe("createThreadConnectorsSelector", () => {
  it("returns the same reference across fresh but equal inputs on every branch", () => {
    const select = createThreadConnectorsSelector();
    const servers = () => [server("claude.ai Google Drive"), server("linear")];

    const none = select(servers(), []);
    expect(select(servers(), [])).toBe(none);
    expect(select(servers(), [tool("Read")])).toBe(none);

    const some = select(servers(), [tool("mcp__linear__go")]);
    expect(some).not.toBe(none);
    expect(select(servers(), [tool("mcp__linear__go")])).toBe(some);
    expect(select(servers(), [tool("mcp__linear__go"), tool("Read")])).toBe(some);

    const empty = select([], []);
    expect(select([], [tool("mcp__linear__go")])).toBe(empty);
  });

  it("short-circuits on identical input arrays", () => {
    const select = createThreadConnectorsSelector();
    const servers = [server("linear")];
    const rows = [tool("linear.go")];
    expect(select(servers, rows)).toBe(select(servers, rows));
  });
});
