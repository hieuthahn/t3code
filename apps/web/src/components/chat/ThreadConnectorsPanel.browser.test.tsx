import { EnvironmentId, ThreadId, type OrchestrationV2McpServerStatus } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ rows: [] as unknown[], requestedRefs: [] as unknown[] }));
vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useQuietThreadVisibleTurnItems: ((ref: unknown) => {
    state.requestedRefs.push(ref);
    return ref === null ? [] : state.rows;
  }) as never,
}));

import { act, render as renderUi } from "../../../test/render";
import { ThreadConnectorsPanel } from "./ThreadConnectorsPanel";

const environmentId = EnvironmentId.make("local");
const threadId = ThreadId.make("thread:one");

const server = (
  name: string,
  status: OrchestrationV2McpServerStatus["status"] = "connected",
): OrchestrationV2McpServerStatus => ({ name, status });

const toolRow = (toolName: string, status = "completed") => ({
  item: { type: "dynamic_tool", toolName, status },
});

async function setup(servers: OrchestrationV2McpServerStatus[], rows: unknown[] = []) {
  state.rows = rows;
  state.requestedRefs = [];
  await using stack = new AsyncDisposableStack();
  const screen = stack.use(await renderUi(null));
  await act(
    async () =>
      await screen.rerender(
        <ThreadConnectorsPanel
          environmentId={environmentId}
          threadId={threadId}
          servers={servers}
        />,
      ),
  );
  const container = screen.container;
  const names = () =>
    Array.from(container.querySelectorAll("[data-mcp-server-status]")).map(
      (row) => row.querySelector("span:nth-of-type(2)")?.textContent,
    );
  const disclosure = () =>
    Array.from(container.querySelectorAll("button")).find((button) =>
      /^Show (all|fewer)/.test(button.textContent ?? ""),
    );
  const environment = stack.move();
  return { container, names, disclosure, [Symbol.asyncDispose]: () => environment.disposeAsync() };
}

const SERVERS = [
  server("claude.ai Google Drive"),
  server("linear"),
  server("claude.ai Firecrawl"),
  server("t3-code"),
];

it("renders nothing and subscribes to nothing without servers", async () => {
  await using fixture = await setup([], [toolRow("mcp__linear__go")]);
  expect(fixture.container.querySelector("[data-thread-connectors-panel]")).toBeNull();
  expect(state.requestedRefs.every((ref) => ref === null)).toBe(true);
});

it("shows only the disclosure when the thread used no server", async () => {
  await using fixture = await setup(SERVERS, [toolRow("Read")]);
  expect(fixture.names()).toEqual([]);
  expect(fixture.disclosure()?.textContent).toBe("Show all (4)");
});

it("lists the used servers and reveals the rest on request", async () => {
  await using fixture = await setup(SERVERS, [
    toolRow("mcp__claude_ai_Google_Drive__search_files"),
    toolRow("linear.list_issues", "failed"),
    toolRow("mcp__t3-code__project_memory_append"),
  ]);
  expect(fixture.names()).toEqual(["claude.ai Google Drive", "linear"]);

  await act(async () => fixture.disclosure()!.click());
  expect(fixture.names()).toEqual([
    "claude.ai Google Drive",
    "linear",
    "claude.ai Firecrawl",
    "t3-code",
  ]);
  expect(fixture.disclosure()?.textContent).toBe("Show fewer");

  await act(async () => fixture.disclosure()!.click());
  expect(fixture.names()).toEqual(["claude.ai Google Drive", "linear"]);
});

it("drops the disclosure once every server is used", async () => {
  await using fixture = await setup([server("linear")], [toolRow("mcp__linear__go")]);
  expect(fixture.names()).toEqual(["linear"]);
  expect(fixture.disclosure()).toBeUndefined();
});

it("keeps a used server that needs sign-in visible and marked", async () => {
  await using fixture = await setup(
    [server("linear", "needs_auth"), server("claude.ai Firecrawl", "failed"), server("other")],
    [toolRow("mcp__linear__go", "waiting"), toolRow("firecrawl.scrape", "failed")],
  );
  expect(fixture.names()).toEqual(["linear", "claude.ai Firecrawl"]);
  const marked = fixture.container.querySelectorAll("[data-mcp-server-attention]");
  expect(marked).toHaveLength(2);
  expect(fixture.container.textContent).toContain("Needs sign-in");
  expect(fixture.container.textContent).toContain("Failed");
});
