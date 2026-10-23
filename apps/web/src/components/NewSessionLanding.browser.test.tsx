import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ProjectId,
  type SavedEnvironment,
} from "@t3tools/contracts";
import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";

const local = EnvironmentId.make("local");
const web = ProjectId.make("project-web");
const api = ProjectId.make("project-api");

const project = (id: ProjectId, title: string, updatedAt: string) => ({
  id,
  environmentId: local,
  title,
  workspaceRoot: `/work/${title}`,
  defaultModelSelection: null,
  scripts: [],
  createdAt: updatedAt,
  updatedAt,
});

const mocks = vi.hoisted(() => ({
  handleNewThread: vi.fn(),
  startScratchThread: vi.fn(),
}));

vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useProjects: () =>
    [
      project(web, "web", "2026-10-02T00:00:00.000Z"),
      project(api, "api", "2026-10-01T00:00:00.000Z"),
    ] as never,
  useThreadShells: () => [],
}));

vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: () =>
    ({
      isReady: true,
      networkStatus: "online",
      environments: [{ environmentId: local, label: "This Mac", serverConfig: null }],
      presentationById: new Map(),
    }) as never,
  usePrimaryEnvironmentId: () => local,
}));

vi.mock(import("~/hooks/useHandleNewThread"), async (original) => ({
  ...(await original()),
  useNewThreadHandler: () => mocks.handleNewThread,
}));

vi.mock(import("~/hooks/useScratchProject"), () => ({
  useScratchProject: () =>
    ({
      scratchEnvironmentId: () => null,
      startScratchThread: mocks.startScratchThread,
    }) as never,
}));

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
  getClientSettings,
} from "~/hooks/useSettings";
import { NewSessionLanding } from "./NewSessionLanding";

function setup(savedEnvironments: readonly SavedEnvironment[] = []): Disposable {
  mocks.handleNewThread.mockReset().mockResolvedValue(null);
  mocks.startScratchThread.mockReset().mockResolvedValue(undefined);
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, savedEnvironments });
  return { [Symbol.dispose]: () => __resetClientSettingsPersistenceForTests() };
}

describe("NewSessionLanding", () => {
  it("starts a thread in a recent folder with one click", async () => {
    using _state = setup();
    await using _screen = await render(<NewSessionLanding />);

    await userEvent.click(page.getByRole("button", { name: /^api/ }));

    expect(mocks.handleNewThread).toHaveBeenCalledExactlyOnceWith(
      { environmentId: local, projectId: api },
      { replace: true },
    );
  });

  it("opens a draft per saved folder in worktrees and leaves the first folder on screen", async () => {
    using _state = setup([
      {
        id: "saved-1",
        name: "Fullstack",
        environmentId: local,
        folders: [api, web],
        worktreePerFolder: true,
      },
    ]);
    await using _screen = await render(<NewSessionLanding />);

    await userEvent.click(page.getByRole("button", { name: /^FullstackThis Mac/ }));

    await vi.waitFor(() => expect(mocks.handleNewThread).toHaveBeenCalledTimes(2));
    expect(mocks.handleNewThread.mock.calls).toEqual([
      [
        { environmentId: local, projectId: web },
        { replace: true, envMode: "worktree" },
      ],
      [
        { environmentId: local, projectId: api },
        { replace: true, envMode: "worktree" },
      ],
    ]);
  });

  it("saves a new environment and deletes it again", async () => {
    using _state = setup();
    await using _screen = await render(<NewSessionLanding />);

    await userEvent.click(page.getByRole("button", { name: "New" }));
    await userEvent.fill(page.getByLabelText("Name"), "Backend");
    await userEvent.click(page.getByRole("dialog").getByText("api", { exact: true }));
    await userEvent.click(page.getByText("Worktree per folder"));
    // Without the app stylesheet the dialog's backdrop covers its footer, so submit from the field.
    await userEvent.type(page.getByLabelText("Name"), "{Enter}");

    await expect.element(page.getByRole("button", { name: /^BackendThis Mac/ })).toBeVisible();
    expect(getClientSettings().savedEnvironments).toMatchObject([
      { name: "Backend", environmentId: local, folders: [api], worktreePerFolder: true },
    ]);

    await userEvent.click(page.getByRole("button", { name: "Backend options" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Delete" }));

    await expect
      .element(page.getByRole("button", { name: /^BackendThis Mac/ }))
      .not.toBeInTheDocument();
    expect(getClientSettings().savedEnvironments).toEqual([]);
  });
});
