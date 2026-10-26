import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { IncludedRepositoriesNote } from "./IncludedRepositoriesNote";

const state = vi.hoisted(() => ({
  paths: [] as string[],
  setting: null as unknown,
  nestedQueries: [] as unknown[],
}));

vi.mock(import("../state/queries"), async (original) => ({
  ...(await original()),
  useNestedRepositories: ((target: unknown) => {
    state.nestedQueries.push(target);
    return {
      data: {
        repositories: state.paths.map((path) => ({ path, name: path, branch: "main" })),
      },
    };
  }) as never,
}));
vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => ({
    settings: {
      projectSettingsOverrides: {},
      worktreeNestedRepositories: state.setting,
    },
  })) as never,
}));
vi.mock(import("../hooks/useT3ProjectFileScripts"), async (original) => ({
  ...(await original()),
  useT3ProjectFileState: (() => ({ status: "missing", file: null, scripts: [] })) as never,
}));

const target = {
  environmentId: EnvironmentId.make("environment"),
  projectId: ProjectId.make("project"),
  workspaceRoot: "/work/nojima",
};

function setup(paths: string[], setting: unknown = null) {
  state.paths = paths;
  state.setting = setting;
  state.nestedQueries = [];
}

describe("IncludedRepositoriesNote", () => {
  it("states how many inner repositories the worktree will include", async () => {
    setup(["a", "b", "c", "d", "e"]);
    await using _screen = await render(<IncludedRepositoriesNote {...target} visible />);
    await expect.element(page.getByText("Includes 5 repos")).toBeVisible();
  });

  it("renders nothing when no inner repository is included", async () => {
    setup([]);
    await using screen = await render(<IncludedRepositoriesNote {...target} visible />);
    expect(screen.container.textContent).toBe("");
  });

  it("renders nothing when the setting is none", async () => {
    setup(["a", "b"], "none");
    await using screen = await render(<IncludedRepositoriesNote {...target} visible />);
    expect(screen.container.textContent).toBe("");
  });

  it("renders nothing and queries nothing outside worktree mode", async () => {
    setup(["a", "b"]);
    await using screen = await render(<IncludedRepositoriesNote {...target} visible={false} />);
    expect(screen.container.textContent).toBe("");
    expect(state.nestedQueries.every((query) => query === null)).toBe(true);
  });
});
