import {
  DEFAULT_TOKEN_SAVER_CONFIG,
  EnvironmentId,
  ProviderDriverKind,
  ThreadId,
  TOKEN_SAVER_OFF_CONFIG,
  estimateTokenSaverSavingPercent,
  type TokenSaverConfig,
  type TokenSaverStats,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { ComposerTokenSaverControl } from "./ComposerTokenSaverControl";

const state = vi.hoisted(() => ({
  defaults: null as TokenSaverConfig | null,
  override: null as TokenSaverConfig | null,
  stats: null as TokenSaverStats | null,
  updates: [] as unknown[],
  settingsPatches: [] as unknown[],
}));

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentSettings: (
    _environmentId: unknown,
    select: (settings: { tokenSaver: unknown }) => unknown,
  ) => select({ tokenSaver: { newThreads: state.defaults } }),
  useUpdateEnvironmentSettings: () => (patch: unknown) => {
    state.settingsPatches.push(patch);
  },
}));
vi.mock("~/state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("~/state/entities", () => ({
  useThreadShell: () => ({ tokenSaver: state.override }),
}));
vi.mock("~/state/orchestration", () => ({ orchestrationEnvironment: { tokenSaverStats: {} } }));
vi.mock("~/state/threads", () => ({ threadEnvironment: { updateMetadata: {} } }));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: () => async () => ({ _tag: "Success", value: state.stats }),
}));
vi.mock("~/state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => async (value: unknown) => {
    state.updates.push(value);
    return { _tag: "Success", value: null };
  },
}));

const sample = (turns: number, averageOutputTokens: number | null) => ({
  turns,
  averageOutputTokens,
  averageInputTokens: averageOutputTokens === null ? null : averageOutputTokens * 40,
  averageCachedInputTokens: null,
});

function setup(input: {
  readonly newThreads?: TokenSaverConfig;
  readonly override?: TokenSaverConfig | null;
  readonly rtkAvailable?: boolean;
}) {
  state.defaults = input.newThreads ?? DEFAULT_TOKEN_SAVER_CONFIG;
  state.override = input.override ?? null;
  state.updates = [];
  state.settingsPatches = [];
  state.stats = {
    thread: { on: sample(6, 210), off: sample(6, 300) },
    overall: { on: sample(40, 315.4), off: sample(3, null) },
    rtkAvailable: input.rtkAvailable ?? true,
  };
}

const threadRef = {
  environmentId: EnvironmentId.make("environment-token-saver"),
  threadId: ThreadId.make("thread-token-saver"),
};
const TOOLS = { rtk: true };
const estimateLabel = (config: TokenSaverConfig) =>
  `−${estimateTokenSaverSavingPercent(config, TOOLS)}% est.`;

async function openPanel() {
  await userEvent.click(page.getByRole("button", { name: /^Token Saver/ }));
  await expect.element(page.getByRole("switch", { name: "RTK compression" })).toBeEnabled();
}

it("recomputes the compound estimate as packs turn on and shows the measured saving", async () => {
  setup({});
  await using _screen = await render(
    <ComposerTokenSaverControl
      threadRef={threadRef}
      driver={ProviderDriverKind.make("claudeAgent")}
    />,
  );
  await openPanel();

  const status = page.getByRole("status");
  await expect
    .element(status.getByText(estimateLabel(DEFAULT_TOKEN_SAVER_CONFIG), { exact: true }))
    .toBeVisible();
  await expect.element(status.getByText("−30% measured output", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Not enough data (3/5 turns)")).toBeVisible();

  await userEvent.click(page.getByRole("switch", { name: "Lean code" }));
  const withLean = { ...DEFAULT_TOKEN_SAVER_CONFIG, leanCode: true };
  await expect.element(status.getByText(estimateLabel(withLean), { exact: true })).toBeVisible();

  await userEvent.click(page.getByRole("button", { name: "Ultra" }));
  const ultra = { ...withLean, concise: "ultra" as const };
  await expect.element(status.getByText(estimateLabel(ultra), { exact: true })).toBeVisible();
  expect(state.updates.at(-1)).toEqual({
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId, tokenSaver: ultra },
  });
});

it("turns every pack off at once", async () => {
  setup({});
  await using _screen = await render(
    <ComposerTokenSaverControl threadRef={threadRef} driver={ProviderDriverKind.make("codex")} />,
  );
  await openPanel();
  const turnAllOff = page.getByRole("button", { name: "Turn all off" });
  await userEvent.click(turnAllOff);

  await expect.element(page.getByRole("status")).toHaveTextContent("Off");
  await expect.element(turnAllOff).toBeDisabled();
  await expect.element(page.getByRole("switch", { name: "Quiet tools" })).not.toBeChecked();
  expect(state.updates.at(-1)).toEqual({
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId, tokenSaver: TOKEN_SAVER_OFF_CONFIG },
  });
});

it("saves the thread's packs as the default for new threads", async () => {
  const own = { ...TOKEN_SAVER_OFF_CONFIG, concise: "full" as const, rtk: true };
  setup({ override: own });
  await using _screen = await render(
    <ComposerTokenSaverControl
      threadRef={threadRef}
      driver={ProviderDriverKind.make("claudeAgent")}
    />,
  );
  await openPanel();
  const startLikeThis = page.getByRole("checkbox", { name: "Start new threads like this" });
  await expect.element(startLikeThis).not.toBeChecked();
  await userEvent.click(startLikeThis);

  expect(state.settingsPatches).toEqual([{ tokenSaver: { newThreads: own } }]);
  await expect.element(startLikeThis).toBeChecked();
});

it("disables RTK with a reason, and counts an rtk-only thread as off, without rtk", async () => {
  setup({ override: { ...TOKEN_SAVER_OFF_CONFIG, rtk: true }, rtkAvailable: false });
  await using _screen = await render(
    <ComposerTokenSaverControl
      threadRef={threadRef}
      driver={ProviderDriverKind.make("claudeAgent")}
    />,
  );
  await userEvent.click(page.getByRole("button", { name: /^Token Saver/ }));
  await expect.element(page.getByRole("switch", { name: "RTK compression" })).toBeDisabled();
  await expect.element(page.getByText("rtk is not installed on this server")).toBeVisible();
  await expect.element(page.getByRole("status")).toHaveTextContent("Off");
});

it("keeps a defaults-following thread's packs when new threads stop using them", async () => {
  setup({});
  await using _screen = await render(
    <ComposerTokenSaverControl
      threadRef={threadRef}
      driver={ProviderDriverKind.make("claudeAgent")}
    />,
  );
  await openPanel();
  const startLikeThis = page.getByRole("checkbox", { name: "Start new threads like this" });
  await expect.element(startLikeThis).toBeChecked();
  await userEvent.click(startLikeThis);

  expect(state.updates).toEqual([
    {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, tokenSaver: DEFAULT_TOKEN_SAVER_CONFIG },
    },
  ]);
  expect(state.settingsPatches).toEqual([{ tokenSaver: { newThreads: TOKEN_SAVER_OFF_CONFIG } }]);
  await expect.element(page.getByRole("switch", { name: "Quiet tools" })).toBeChecked();
});

it("is always in the composer with fresh settings, off until a pack turns on", async () => {
  setup({ newThreads: TOKEN_SAVER_OFF_CONFIG });
  await using _screen = await render(
    <ComposerTokenSaverControl
      threadRef={threadRef}
      driver={ProviderDriverKind.make("claudeAgent")}
    />,
  );
  await openPanel();
  await expect.element(page.getByRole("status")).toHaveTextContent("Off");
  await userEvent.click(page.getByRole("switch", { name: "Quiet tools" }));
  await expect
    .element(page.getByRole("status").getByText("−15% est.", { exact: true }))
    .toBeVisible();
});

it("opens from the overflow menu while its own button is hidden", async () => {
  setup({});
  const onOpenChange = vi.fn();
  await using screen = await render(
    <ComposerTokenSaverControl
      threadRef={threadRef}
      driver={ProviderDriverKind.make("claudeAgent")}
      open={false}
      onOpenChange={onOpenChange}
    />,
  );
  await screen.rerender(
    <ComposerTokenSaverControl
      threadRef={threadRef}
      driver={ProviderDriverKind.make("claudeAgent")}
      open
      onOpenChange={onOpenChange}
    />,
  );
  await expect.element(page.getByRole("switch", { name: "RTK compression" })).toBeEnabled();
  await userEvent.keyboard("{Escape}");
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
});

it("stays out of the composer for unsupported providers", async () => {
  setup({});
  await using screen = await render(
    <ComposerTokenSaverControl
      threadRef={threadRef}
      driver={ProviderDriverKind.make("opencode")}
    />,
  );
  expect(screen.container.querySelector("button")).toBeNull();
});
