import {
  DEFAULT_TEAM_LIMITS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type TeamProfile,
  type TeamRunView,
  type TeamSetup,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ComposerTeamControl } from "./ComposerTeamControl";

const state = vi.hoisted(() => ({
  team: null as TeamSetup | null,
  profiles: [] as TeamProfile[],
  defaultSetup: null as TeamSetup | null,
  newThreads: false,
  canOperate: true,
  canWriteSettings: true,
  metadata: [] as unknown[],
  settings: [] as unknown[],
  run: null as TeamRunView | null,
  metadataFailure: null as string | null,
}));

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentSettings: (_environmentId: unknown, select: (settings: unknown) => unknown) =>
    select({
      team: {
        profiles: state.profiles,
        defaultSetup: state.defaultSetup,
        newThreads: state.newThreads,
      },
    }),
  useUpdateEnvironmentSettings: () => (patch: unknown) => {
    state.settings.push(patch);
  },
}));
vi.mock("~/state/entities", () => ({ useThreadShell: () => ({ team: state.team }) }));
vi.mock("~/state/threads", () => ({ threadEnvironment: { updateMetadata: {} } }));
vi.mock("~/state/session", async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: (_environmentId: unknown, scope: string) =>
    scope === "orchestration:operate" ? state.canOperate : state.canWriteSettings,
}));
vi.mock("~/state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => async (value: unknown) => {
    state.metadata.push(value);
    if (state.metadataFailure === null) return { _tag: "Success", value: null };
    const Cause = await import("effect/Cause");
    return { _tag: "Failure", cause: Cause.fail(new Error(state.metadataFailure)) };
  },
}));
vi.mock("~/state/query", async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuery: (atom: unknown) => ({ data: atom === null ? null : state.run, error: null }),
}));
// The model pickers need the provider catalog; a stub keeps this test on the popover's own logic.
vi.mock("./TeamMemberPicker", () => ({
  TeamMemberPicker: (props: {
    label: string;
    member: { instanceId: string; model: string };
    onRemove?: () => void;
  }) => (
    <div role="group" aria-label={props.label}>
      {props.member.instanceId}:{props.member.model}
      {props.onRemove === undefined ? null : (
        <button type="button" aria-label={`Remove ${props.label}`} onClick={props.onRemove} />
      )}
    </div>
  ),
}));

const threadRef = {
  environmentId: EnvironmentId.make("environment-team"),
  threadId: ThreadId.make("thread-team"),
};
const architect = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-opus-4-1" };
const worker = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" };

function setup(overrides: Partial<typeof state> = {}) {
  Object.assign(state, {
    team: null,
    profiles: [],
    defaultSetup: null,
    newThreads: false,
    canOperate: true,
    canWriteSettings: true,
    metadata: [],
    settings: [],
    run: null,
    metadataFailure: null,
    ...overrides,
  });
}

const renderControl = () =>
  render(
    <ComposerTeamControl
      threadRef={threadRef}
      driver={ProviderDriverKind.make("claudeAgent")}
      threadModel={architect}
      lockedProvider={null}
      instanceEntries={[]}
      modelOptionsByInstance={new Map()}
    />,
  );

it("starts a team from the thread's model and saves it as the default", async () => {
  setup();
  await using _screen = await renderControl();
  const trigger = page.getByRole("button", { name: "Team" });
  await expect.element(trigger).toHaveTextContent("Team");
  await userEvent.click(trigger);
  await expect
    .element(page.getByRole("group", { name: "Architect" }))
    .toHaveTextContent("claudeAgent:claude-opus-4-1");
  await userEvent.click(page.getByRole("button", { name: "Start team" }));

  const team = { architect, workers: [architect], limits: DEFAULT_TEAM_LIMITS };
  expect(state.metadata).toEqual([
    {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, team, modelSelection: architect },
    },
  ]);
  expect(state.settings).toEqual([{ team: { defaultSetup: team } }]);
});

it("adds and removes workers up to six", async () => {
  setup({ team: { architect, workers: [worker], limits: DEFAULT_TEAM_LIMITS } });
  await using _screen = await renderControl();
  await expect
    .element(page.getByRole("button", { name: "Team" }))
    .toHaveTextContent("Team · 1 worker");
  await userEvent.click(page.getByRole("button", { name: "Team" }));
  const add = page.getByRole("button", { name: "Add worker" });
  for (let count = 1; count < 6; count += 1) await userEvent.click(add);
  await expect.element(page.getByText("Workers 6/6")).toBeVisible();
  await expect.element(add).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "Remove Worker 6" }));
  await userEvent.click(page.getByRole("button", { name: "Apply" }));
  const applied = state.metadata[0] as { input: { team: TeamSetup } };
  expect(applied.input.team.workers).toHaveLength(5);
});

it("keeps lead guidance after the rules and clears it with Reset", async () => {
  setup({
    team: {
      architect,
      workers: [worker],
      limits: DEFAULT_TEAM_LIMITS,
      leadGuidance: "Coordinate only.",
    },
  });
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: "Team" }));
  await userEvent.click(page.getByRole("button", { name: "Lead guidance" }));
  await expect
    .element(page.getByRole("textbox", { name: "Lead guidance" }))
    .toHaveValue("Coordinate only.");
  await userEvent.click(page.getByRole("button", { name: "Reset" }));
  await userEvent.click(page.getByRole("button", { name: "Apply" }));
  const applied = state.metadata[0] as { input: { team: TeamSetup } };
  expect(applied.input.team).not.toHaveProperty("leadGuidance");
});

it("saves the setup as a named profile", async () => {
  setup();
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: "Team" }));
  await userEvent.click(page.getByRole("button", { name: "Team profile actions" }));
  await userEvent.click(page.getByRole("menuitem", { name: "Save as…" }));
  await userEvent.fill(page.getByRole("textbox", { name: "Team profile name" }), "Review crew");
  await userEvent.click(page.getByRole("button", { name: "Save" }));
  const saved = state.settings[0] as { team: { profiles: TeamProfile[] } };
  expect(saved.team.profiles.map((profile) => profile.name)).toEqual(["Review crew"]);
});

it("turns a team back into a single agent", async () => {
  setup({ team: { architect, workers: [worker], limits: DEFAULT_TEAM_LIMITS } });
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: "Team" }));
  await userEvent.click(page.getByRole("button", { name: "Single agent" }));
  expect(state.metadata).toEqual([
    { environmentId: threadRef.environmentId, input: { threadId: threadRef.threadId, team: null } },
  ]);
  expect(state.settings).toEqual([]);
});

it("refuses changes without permission to operate the thread", async () => {
  setup({ canOperate: false, canWriteSettings: false });
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: "Team" }));
  await expect.element(page.getByRole("button", { name: "Start team" })).toBeDisabled();
  await expect.element(page.getByRole("button", { name: "Team profile actions" })).toBeDisabled();
});

it("lets a team start assignments without the approval card", async () => {
  setup({ team: { architect, workers: [worker], limits: DEFAULT_TEAM_LIMITS } });
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: "Team" }));
  await userEvent.click(page.getByText("Start assignments without approval"));
  await userEvent.click(page.getByRole("button", { name: "Apply" }));
  const applied = state.metadata[0] as { input: { team: TeamSetup } };
  expect(applied.input.team.autonomous).toBe(true);
});

it("refuses limits below what the running team already used", async () => {
  const team = { architect, workers: [worker], limits: DEFAULT_TEAM_LIMITS };
  setup({
    team,
    profiles: [
      {
        id: "small",
        name: "Small crew",
        setup: { ...team, limits: { ...DEFAULT_TEAM_LIMITS, maxAssignments: 3 } },
      },
    ],
    run: {
      threadId: threadRef.threadId,
      status: "running",
      limits: DEFAULT_TEAM_LIMITS,
      usage: { rounds: 2, assignments: 5 },
      stalls: 0,
      report: null,
      summary: null,
      assignments: [],
      updatedAt: "2026-10-24T00:00:00.000Z",
    },
  });
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: "Team" }));
  await userEvent.click(page.getByRole("combobox", { name: "Team profile" }));
  await userEvent.click(page.getByRole("option", { name: "Small crew" }));
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("maxAssignments cannot go below the 5 assignments already made.");
  await expect.element(page.getByRole("button", { name: "Apply" })).toBeDisabled();
});

it("names the popover after the architect and its workers", async () => {
  setup();
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: "Team" }));
  await expect.element(page.getByText("Architect & workers")).toBeVisible();
});

it("offers to save the setup when no profile is saved yet", async () => {
  setup();
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: "Team" }));
  await userEvent.click(page.getByRole("combobox", { name: "Team profile" }));
  await expect.element(page.getByRole("option", { name: "No saved profiles" })).toBeVisible();
  await userEvent.click(page.getByRole("option", { name: "Save current setup as…" }));
  await userEvent.fill(page.getByRole("textbox", { name: "Team profile name" }), "Pair");
  await userEvent.click(page.getByRole("button", { name: "Save" }));
  const saved = state.settings[0] as { team: { profiles: TeamProfile[] } };
  expect(saved.team.profiles.map((profile) => profile.name)).toEqual(["Pair"]);
});

it("closes the popover once Apply lands", async () => {
  setup({ team: { architect, workers: [worker], limits: DEFAULT_TEAM_LIMITS } });
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: "Team" }));
  await userEvent.click(page.getByRole("button", { name: "Apply" }));
  await expect.element(page.getByRole("button", { name: "Apply" })).not.toBeInTheDocument();
});

it("keeps the popover open and shows why Apply failed", async () => {
  setup({
    team: { architect, workers: [worker], limits: DEFAULT_TEAM_LIMITS },
    metadataFailure: "The thread is busy.",
  });
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: "Team" }));
  await userEvent.click(page.getByRole("button", { name: "Apply" }));
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Could not apply the team: The thread is busy.");
  await expect.element(page.getByRole("button", { name: "Apply" })).toBeVisible();
});
