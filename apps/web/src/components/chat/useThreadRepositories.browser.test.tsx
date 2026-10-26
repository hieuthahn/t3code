import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { useRepositorySelectionStore } from "../../repositorySelectionStore";
import { render } from "../../../test/render";
import { useThreadRepositories } from "./useThreadRepositories";

const state = vi.hoisted(() => ({
  repositories: [] as { path: string; name: string; branch: string | null; originUrl: null }[],
  tags: {} as Record<string, string[]>,
  touchCounts: undefined as Record<string, Record<string, number>> | undefined,
  statusCwds: [] as string[],
  nestedQueries: [] as unknown[],
}));

vi.mock(import("../../state/queries"), async (original) => ({
  ...(await original()),
  useNestedRepositories: ((target: unknown) => {
    state.nestedQueries.push(target);
    return { data: { repositories: state.repositories } };
  }) as never,
  useThreadRepositoryTags: (() => ({
    data: { threads: state.tags, touchCounts: state.touchCounts },
  })) as never,
}));
vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: ((query: { cwd?: string } | null) => {
    if (query !== null) state.statusCwds.push(JSON.stringify(query));
    return { data: { refName: "dev" } };
  }) as never,
}));

const environmentId = EnvironmentId.make("environment");
const threadId = ThreadId.make("thread");
const target = {
  environmentId,
  projectId: ProjectId.make("project"),
  threadId,
  projectName: "Nojima",
  workspaceRoot: "/work/nojima",
  worktreePath: null,
};

function Probe(props: {
  readonly worktreePath?: string | null;
  readonly envMode?: "local" | "worktree";
}) {
  const repositories = useThreadRepositories({
    ...target,
    worktreePath: props.worktreePath ?? null,
    ...(props.envMode ? { envMode: props.envMode } : {}),
  });
  return (
    <div>
      <output data-testid="labels">{repositories.options.map((o) => o.label).join(",")}</output>
      <output data-testid="cwd">{repositories.repositoryCwd ?? "outer"}</output>
      <button type="button" onClick={() => repositories.select("backend")}>
        pick backend
      </button>
    </div>
  );
}

function setup(
  repositories = [{ path: "backend", name: "backend", branch: "main", originUrl: null }],
) {
  state.repositories = repositories;
  state.tags = {};
  state.touchCounts = undefined;
  state.statusCwds = [];
  state.nestedQueries = [];
  useRepositorySelectionStore.setState({ byThreadKey: {} });
}

describe("useThreadRepositories", () => {
  it("offers no options for a project without nested repositories", async () => {
    setup([]);
    await using _screen = await render(<Probe />);
    await expect.element(page.getByTestId("labels")).toBeEmptyDOMElement();
    await expect.element(page.getByTestId("cwd")).toHaveTextContent("outer");
  });

  it("offers no options for a worktree thread whose worktree holds no inner worktrees", async () => {
    setup([]);
    await using _screen = await render(<Probe worktreePath="/wt" />);
    await expect.element(page.getByTestId("labels")).toBeEmptyDOMElement();
    await expect.element(page.getByTestId("cwd")).toHaveTextContent("outer");
  });

  it("points the selector at the inner worktrees of a worktree thread", async () => {
    setup();
    await using _screen = await render(<Probe worktreePath="/wt" />);
    await expect.element(page.getByTestId("labels")).toHaveTextContent("Nojima,backend");
    await expect.element(page.getByTestId("cwd")).toHaveTextContent("outer");
    expect(state.nestedQueries.at(-1)).toMatchObject({ threadId });

    await page.getByRole("button", { name: "pick backend" }).click();
    await expect.element(page.getByTestId("cwd")).toHaveTextContent("/wt/backend");
    for (const query of state.statusCwds) {
      expect(query).toContain('\\"cwd\\":\\"/wt\\"');
    }
  });

  it("lists the project root repositories without a thread id outside a worktree", async () => {
    setup();
    await using _screen = await render(<Probe />);
    expect(state.nestedQueries.at(-1)).not.toHaveProperty("threadId");
  });

  it("targets the outer repository by default", async () => {
    setup();
    await using _screen = await render(<Probe />);
    await expect.element(page.getByTestId("labels")).toHaveTextContent("Nojima,backend");
    await expect.element(page.getByTestId("cwd")).toHaveTextContent("outer");
  });

  it("defaults to the tagged nested repository", async () => {
    setup();
    state.tags = { [threadId]: ["backend"] };
    await using _screen = await render(<Probe />);
    await expect.element(page.getByTestId("cwd")).toHaveTextContent("/work/nojima/backend");
  });

  it("persists a choice and falls back to the outer repository when it disappears", async () => {
    setup();
    await using screen = await render(<Probe />);
    await page.getByRole("button", { name: "pick backend" }).click();
    await expect.element(page.getByTestId("cwd")).toHaveTextContent("/work/nojima/backend");

    state.repositories = [{ path: "other", name: "other", branch: null, originUrl: null }];
    await screen.rerender(<Probe />);
    await expect.element(page.getByTestId("cwd")).toHaveTextContent("outer");
  });

  it("defaults to the most touched repository", async () => {
    setup([
      { path: "backend", name: "backend", branch: "main", originUrl: null },
      { path: "web", name: "web", branch: "main", originUrl: null },
    ]);
    state.tags = { [threadId]: ["backend", "web"] };
    state.touchCounts = { [threadId]: { backend: 1, web: 4 } };
    await using _screen = await render(<Probe />);
    await expect.element(page.getByTestId("cwd")).toHaveTextContent("/work/nojima/web");
  });

  it("clears a stored choice once its repository is no longer listed", async () => {
    setup();
    await using screen = await render(<Probe />);
    await page.getByRole("button", { name: "pick backend" }).click();
    state.repositories = [{ path: "other", name: "other", branch: null, originUrl: null }];
    await screen.rerender(<Probe />);
    await vi.waitFor(() => expect(useRepositorySelectionStore.getState().byThreadKey).toEqual({}));
  });

  it("never applies a nested cwd to a worktree-mode draft without a worktree", async () => {
    setup();
    state.tags = { [threadId]: ["backend"] };
    useRepositorySelectionStore.getState().select({ environmentId, threadId }, "backend");
    await using _screen = await render(<Probe envMode="worktree" />);
    await expect.element(page.getByTestId("labels")).toBeEmptyDOMElement();
    await expect.element(page.getByTestId("cwd")).toHaveTextContent("outer");
  });

  it("watches no status beyond the project root across many repositories", async () => {
    setup([
      { path: "a", name: "a", branch: "main", originUrl: null },
      { path: "b", name: "b", branch: "main", originUrl: null },
      { path: "c", name: "c", branch: "main", originUrl: null },
    ]);
    await using _screen = await render(<Probe />);
    await expect.element(page.getByTestId("labels")).toHaveTextContent("Nojima,a,b,c");
    expect(state.statusCwds.length).toBeGreaterThan(0);
    for (const query of state.statusCwds) {
      expect(query).toContain('\\"cwd\\":\\"/work/nojima\\"');
    }
  });
});
