import {
  DEFAULT_TEAM_LIMITS,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type TeamAssignmentView,
  type TeamRunView,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  allowed: true,
  view: null as TeamRunView | null,
  calls: [] as Array<{ readonly action: string; readonly input: unknown }>,
}));
vi.mock(import("../../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => state.allowed,
  readEnvironmentScope: () => state.allowed,
}));
// The panel reads the operate permission through an atom; the grant is the boundary under test.
vi.mock(import("@effect/atom-react"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomValue: (() => state.allowed) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (importOriginal) => {
  const { serverEnvironment } = await import("../../state/server");
  const actions = new Map<unknown, string>([
    [serverEnvironment.pauseTeam, "pause"],
    [serverEnvironment.resumeTeam, "resume"],
    [serverEnvironment.stopTeam, "stop"],
  ]);
  return {
    ...(await importOriginal()),
    useAtomCommand: ((command: unknown) => async (input: unknown) => {
      state.calls.push({ action: actions.get(command) ?? "unknown", input });
      return { _tag: "Success" };
    }) as never,
  };
});
vi.mock(import("../../state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuery: (() => ({ data: state.view, error: null })) as never,
}));

import { act, render as renderUi } from "../../../test/render";
import { ThreadTeamPanel } from "./ThreadTeamPanel";

const environmentId = EnvironmentId.make("local");
const threadId = ThreadId.make("thread:architect");

const assignment = (overrides: Partial<TeamAssignmentView>): TeamAssignmentView => ({
  key: "api",
  title: "Build the API",
  providerInstanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5-codex",
  status: "waiting",
  attempts: 0,
  dependsOn: [],
  readOnly: false,
  files: [],
  isolation: "worktree",
  taskId: null,
  childThreadId: null,
  waitReason: null,
  failure: null,
  result: null,
  updatedAt: "2026-10-24T00:00:00.000Z",
  ...overrides,
});

const run = (overrides: Partial<TeamRunView>): TeamRunView => ({
  threadId,
  status: "running",
  limits: DEFAULT_TEAM_LIMITS,
  usage: { rounds: 1, assignments: 3 },
  stalls: 0,
  report: null,
  summary: null,
  assignments: [],
  updatedAt: "2026-10-24T00:00:00.000Z",
  ...overrides,
});

async function setup(view: TeamRunView | null) {
  state.allowed = true;
  state.view = view;
  state.calls = [];
  await using stack = new AsyncDisposableStack();
  const screen = stack.use(await renderUi(null));
  await act(
    async () =>
      await screen.rerender(<ThreadTeamPanel environmentId={environmentId} threadId={threadId} />),
  );
  const container = screen.container;
  const byLabel = (label: string) =>
    container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  const environment = stack.move();
  return { container, byLabel, [Symbol.asyncDispose]: () => environment.disposeAsync() };
}

it("shows nothing for a thread without a team run", async () => {
  await using fixture = await setup(null);
  expect(fixture.container.querySelector("[data-thread-team-panel]")).toBeNull();
});

it("says what each waiting assignment waits for", async () => {
  await using fixture = await setup(
    run({
      assignments: [
        assignment({ key: "api", status: "running", attempts: 1 }),
        assignment({
          key: "tests",
          title: "Write tests",
          waitReason: { _tag: "dependency", keys: ["api"] },
        }),
        assignment({
          key: "login",
          title: "Fix login",
          isolation: "shared",
          files: ["src/auth"],
          waitReason: { _tag: "write_scope", key: "auth", files: ["src/auth"] },
        }),
        assignment({
          key: "docs",
          title: "Update docs",
          waitReason: {
            _tag: "account_busy",
            instanceId: ProviderInstanceId.make("codex"),
            running: 2,
          },
        }),
      ],
    }),
  );
  const text = fixture.container.textContent ?? "";
  expect(text).toContain("Round 1/8 · 3/12 assignments");
  expect(text).toContain("api · gpt-5-codex · running");
  expect(text).toContain("tests · gpt-5-codex · waits for api");
  expect(text).toContain("login · gpt-5-codex · waits for auth to finish writing src/auth");
  expect(text).toContain("docs · gpt-5-codex · waits for a free codex slot");
});

it("pauses a running team and resumes a paused one", async () => {
  {
    await using fixture = await setup(run({}));
    expect(fixture.byLabel("Resume the team")).toBeNull();
    await act(async () => fixture.byLabel("Pause the team")!.click());
    expect(state.calls).toEqual([
      { action: "pause", input: { environmentId, input: { threadId } } },
    ]);
  }
  {
    await using fixture = await setup(
      run({ status: "paused", report: "The architect stopped twice without finishing the team." }),
    );
    expect(fixture.container.textContent).toContain("stopped twice");
    expect(fixture.byLabel("Pause the team")).toBeNull();
    await act(async () => fixture.byLabel("Resume the team")!.click());
    expect(state.calls.at(-1)?.action).toBe("resume");
  }
});

it("offers Resume after a restart and Stop while the team is open", async () => {
  await using fixture = await setup(run({ status: "interrupted" }));
  expect(fixture.container.textContent).toContain("Interrupted by a restart");
  await act(async () => fixture.byLabel("Stop the team")!.click());
  expect(state.calls.at(-1)?.action).toBe("stop");
});

it("hides the controls of a finished team and disables them without permission", async () => {
  {
    await using fixture = await setup(run({ status: "finished" }));
    expect(fixture.byLabel("Stop the team")).toBeNull();
    expect(fixture.byLabel("Resume the team")).toBeNull();
  }
  state.allowed = false;
  const view = run({});
  state.view = view;
  await using stack = new AsyncDisposableStack();
  const screen = stack.use(await renderUi(null));
  await act(
    async () =>
      await screen.rerender(<ThreadTeamPanel environmentId={environmentId} threadId={threadId} />),
  );
  const pause = screen.container.querySelector<HTMLButtonElement>('[aria-label="Pause the team"]');
  expect(pause?.disabled).toBe(true);
});
