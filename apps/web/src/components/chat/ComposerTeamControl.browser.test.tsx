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
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import {
  clearDraftComposerSettings,
  readDraftComposerSettings,
} from "~/draftComposerSettingsStore";
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
  draftModels: [] as unknown[],
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
vi.mock("~/state/entities", () => ({
  useThreadShell: (ref: unknown) => (ref === null ? null : { team: state.team }),
}));
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
const threadKey = scopedThreadKey(threadRef);
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
    draftModels: [],
    ...overrides,
  });
  clearDraftComposerSettings(threadKey);
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

const renderDraftControl = (driver = "claudeAgent") =>
  render(
    <ComposerTeamControl
      threadRef={threadRef}
      isDraft
      onDraftArchitect={(selection) => state.draftModels.push(selection)}
      driver={ProviderDriverKind.make(driver)}
      threadModel={architect}
      lockedProvider={null}
      instanceEntries={[]}
      modelOptionsByInstance={new Map()}
    />,
  );

it("keeps a draft's team in the draft until its first send creates the thread", async () => {
  setup();
  await using _screen = await renderDraftControl();
  await userEvent.click(page.getByRole("button", { name: /^Team(, |$)/ }));
  await userEvent.click(page.getByRole("button", { name: "Start team" }));

  const team = { architect, workers: [architect], limits: DEFAULT_TEAM_LIMITS };
  expect(state.metadata).toEqual([]);
  expect(readDraftComposerSettings(threadKey).team).toEqual(team);
  expect(state.draftModels).toEqual([architect]);
  await expect.element(page.getByRole("button", { name: "Team, 1 worker" })).toBeInTheDocument();
});

it("turns a draft into a single agent even when new threads start as a team", async () => {
  setup({
    newThreads: true,
    defaultSetup: { architect, workers: [worker], limits: DEFAULT_TEAM_LIMITS },
  });
  await using _screen = await renderDraftControl();
  await userEvent.click(page.getByRole("button", { name: "Team, 1 worker" }));
  await userEvent.click(page.getByRole("button", { name: "Use a single agent" }));

  expect(state.metadata).toEqual([]);
  expect(readDraftComposerSettings(threadKey).team).toBeNull();
  await expect.element(page.getByRole("button", { name: "Team" })).toBeInTheDocument();
});

it("hides on a draft whose provider cannot run a team", async () => {
  setup();
  await using _screen = await renderDraftControl("cursor");
  await expect.element(page.getByRole("button", { name: /^Team(, |$)/ })).not.toBeInTheDocument();
});

it("starts a team from the thread's model and saves it as the default", async () => {
  setup();
  await using _screen = await renderControl();
  const trigger = page.getByRole("button", { name: /^Team(, |$)/ });
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
  await userEvent.click(page.getByRole("button", { name: /^Team(, |$)/ }));
  const add = page.getByRole("button", { name: "Add worker" });
  for (let count = 1; count < 6; count += 1) await userEvent.click(add);
  await expect.element(page.getByText("Workers 6/6")).toBeVisible();
  await expect.element(add).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "Remove Worker 6" }));
  await userEvent.click(page.getByRole("button", { name: "Save setup" }));
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
  await userEvent.click(page.getByRole("button", { name: /^Team(, |$)/ }));
  await userEvent.click(page.getByRole("button", { name: "Lead guidance" }));
  await expect
    .element(page.getByRole("textbox", { name: "Lead guidance" }))
    .toHaveValue("Coordinate only.");
  await userEvent.click(page.getByRole("button", { name: "Reset" }));
  await userEvent.click(page.getByRole("button", { name: "Save setup" }));
  const applied = state.metadata[0] as { input: { team: TeamSetup } };
  expect(applied.input.team).not.toHaveProperty("leadGuidance");
});

it("saves the setup as a named profile", async () => {
  setup();
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: /^Team(, |$)/ }));
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
  await userEvent.click(page.getByRole("button", { name: /^Team(, |$)/ }));
  await userEvent.click(page.getByRole("button", { name: "Use a single agent" }));
  expect(state.metadata).toEqual([
    { environmentId: threadRef.environmentId, input: { threadId: threadRef.threadId, team: null } },
  ]);
  expect(state.settings).toEqual([]);
});

it("refuses changes without permission to operate the thread", async () => {
  setup({ canOperate: false, canWriteSettings: false });
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: /^Team(, |$)/ }));
  await expect.element(page.getByRole("button", { name: "Start team" })).toBeDisabled();
  await expect.element(page.getByRole("button", { name: "Team profile actions" })).toBeDisabled();
});

it("lets a team start assignments without the approval card", async () => {
  setup({ team: { architect, workers: [worker], limits: DEFAULT_TEAM_LIMITS } });
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: /^Team(, |$)/ }));
  await userEvent.click(page.getByText("Start assignments without approval"));
  await userEvent.click(page.getByRole("button", { name: "Save setup" }));
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
  await userEvent.click(page.getByRole("button", { name: /^Team(, |$)/ }));
  await userEvent.click(page.getByRole("combobox", { name: "Team profile" }));
  await userEvent.click(page.getByRole("option", { name: "Small crew" }));
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("maxAssignments cannot go below the 5 assignments already made.");
  await expect.element(page.getByRole("button", { name: "Save setup" })).toBeDisabled();
});

it("names the popover after the architect and its workers", async () => {
  setup();
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: /^Team(, |$)/ }));
  await expect.element(page.getByText("Architect & workers")).toBeVisible();
});

it("offers to save the setup when no profile is saved yet", async () => {
  setup();
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: /^Team(, |$)/ }));
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
  await userEvent.click(page.getByRole("button", { name: /^Team(, |$)/ }));
  await userEvent.click(page.getByRole("button", { name: "Save setup" }));
  await expect.element(page.getByRole("button", { name: "Save setup" })).not.toBeInTheDocument();
});

it("keeps the popover open and shows why Apply failed", async () => {
  setup({
    team: { architect, workers: [worker], limits: DEFAULT_TEAM_LIMITS },
    metadataFailure: "The thread is busy.",
  });
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: /^Team(, |$)/ }));
  await userEvent.click(page.getByRole("button", { name: "Save setup" }));
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Could not apply the team: The thread is busy.");
  await expect.element(page.getByRole("button", { name: "Save setup" })).toBeVisible();
});

it("shows the Team button pressed while a team runs, with its worker count", async () => {
  setup({ team: { architect, workers: [worker, worker], limits: DEFAULT_TEAM_LIMITS } });
  await using _screen = await renderControl();
  const trigger = page.getByRole("button", { name: "Team, 2 workers" });
  await expect.element(trigger).toHaveAttribute("aria-pressed", "true");
  await expect.element(trigger).toHaveTextContent("Team2");
});

it("shows the Team button released for a single agent", async () => {
  setup();
  await using _screen = await renderControl();
  const trigger = page.getByRole("button", { name: "Team", exact: true });
  await expect.element(trigger).toHaveAttribute("aria-pressed", "false");
  await expect.element(trigger).toHaveTextContent("Team");
});

it("numbers the workers and closes from the header", async () => {
  setup({ team: { architect, workers: [worker, worker], limits: DEFAULT_TEAM_LIMITS } });
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: /^Team(, |$)/ }));
  await expect.element(page.getByText("Plans & reviews")).toBeVisible();
  await expect.element(page.getByText("Worker 1", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Worker 2", { exact: true })).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Close" }));
  await expect.element(page.getByRole("button", { name: "Save setup" })).not.toBeInTheDocument();
  expect(state.metadata).toEqual([]);
});

it("runs any number of workers at once when Unlimited is checked", async () => {
  setup({
    team: { architect, workers: [worker], limits: { ...DEFAULT_TEAM_LIMITS, maxParallel: 2 } },
  });
  await using _screen = await renderControl();
  await userEvent.click(page.getByRole("button", { name: /^Team(, |$)/ }));
  await userEvent.click(page.getByRole("button", { name: "Run limits & context" }));
  await expect.element(page.getByRole("textbox", { name: "At once" })).toBeEnabled();
  await userEvent.click(page.getByText("Unlimited", { exact: true }));
  await expect.element(page.getByRole("textbox", { name: "At once" })).toBeDisabled();
  await userEvent.click(page.getByRole("button", { name: "Save setup" }));
  const applied = state.metadata[0] as { input: { team: TeamSetup } };
  expect(applied.input.team.limits.maxParallel).toBe("unlimited");
});
