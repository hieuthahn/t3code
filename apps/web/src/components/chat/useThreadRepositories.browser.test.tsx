import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { useRepositorySelectionStore } from "../../repositorySelectionStore";
import { render } from "../../../test/render";
import { useThreadRepositories } from "./useThreadRepositories";

const state = vi.hoisted(() => ({
  repositories: [] as { path: string; name: string; branch: string | null; originUrl: null }[],
  tags: {} as Record<string, string[]>,
  statusCwds: [] as string[],
}));

vi.mock(import("../../state/queries"), async (original) => ({
  ...(await original()),
  useNestedRepositories: (() => ({ data: { repositories: state.repositories } })) as never,
  useThreadRepositoryTags: (() => ({ data: { threads: state.tags } })) as never,
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

function Probe(props: { readonly worktreePath?: string | null }) {
  const repositories = useThreadRepositories({
    ...target,
    worktreePath: props.worktreePath ?? null,
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
  useRepositorySelectionStore.setState({ byThreadKey: {} });
}

describe("useThreadRepositories", () => {
  it("offers no options for a project without nested repositories", async () => {
    setup([]);
    await using _screen = await render(<Probe />);
    await expect.element(page.getByTestId("labels")).toBeEmptyDOMElement();
    await expect.element(page.getByTestId("cwd")).toHaveTextContent("outer");
  });

  it("offers no options for a worktree thread", async () => {
    setup();
    await using _screen = await render(<Probe worktreePath="/wt" />);
    await expect.element(page.getByTestId("labels")).toBeEmptyDOMElement();
    await expect.element(page.getByTestId("cwd")).toHaveTextContent("outer");
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
});
