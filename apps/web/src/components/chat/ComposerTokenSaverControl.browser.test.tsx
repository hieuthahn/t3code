import {
  DEFAULT_TOKEN_SAVER_CONFIG,
  EnvironmentId,
  ProviderDriverKind,
  ThreadId,
  type TokenSaverConfig,
  type TokenSaverStats,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ComposerTokenSaverControl } from "./ComposerTokenSaverControl";

const state = vi.hoisted(() => ({
  enabled: true,
  override: null as TokenSaverConfig | null,
  stats: null as TokenSaverStats | null,
  updates: [] as unknown[],
}));

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentSettings: (
    _environmentId: unknown,
    select: (settings: { tokenSaver: unknown }) => unknown,
  ) => select({ tokenSaver: { enabled: state.enabled, defaults: DEFAULT_TOKEN_SAVER_CONFIG } }),
}));
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

function setup(input: { readonly enabled?: boolean; readonly override?: TokenSaverConfig | null }) {
  state.enabled = input.enabled ?? true;
  state.override = input.override ?? null;
  state.updates = [];
  state.stats = {
    thread: { on: sample(6, 210), off: sample(2, null) },
    overall: { on: sample(40, 315.4), off: sample(120, 842) },
  };
}

const threadRef = {
  environmentId: EnvironmentId.make("environment-token-saver"),
  threadId: ThreadId.make("thread-token-saver"),
};

it("shows the thread's packs and measured tokens with a minimum sample", async () => {
  setup({});
  await using _screen = await render(
    <ComposerTokenSaverControl
      threadRef={threadRef}
      driver={ProviderDriverKind.make("claudeAgent")}
    />,
  );
  const trigger = page.getByRole("button", { name: "Token Saver" });
  await expect.element(trigger).toHaveTextContent("Lite");
  await userEvent.click(trigger);

  await expect.element(page.getByText("Using defaults")).toBeVisible();
  await expect.element(page.getByText(/^210 out · 8,400 in · 6 turns$/)).toBeVisible();
  await expect.element(page.getByText("Not enough data (2/5 turns)")).toBeVisible();
  await expect.element(page.getByText(/^842 out · 33,680 in · 120 turns$/)).toBeVisible();

  await userEvent.click(page.getByRole("button", { name: "Ultra" }));
  expect(state.updates).toEqual([
    {
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        tokenSaver: { ...DEFAULT_TOKEN_SAVER_CONFIG, concise: "ultra" },
      },
    },
  ]);
});

it("offers a way back to the defaults for a thread with its own packs", async () => {
  setup({ override: { concise: "off", leanCode: true, quietTools: false } });
  await using _screen = await render(
    <ComposerTokenSaverControl threadRef={threadRef} driver={ProviderDriverKind.make("codex")} />,
  );
  const trigger = page.getByRole("button", { name: "Token Saver" });
  await expect.element(trigger).toHaveTextContent("Saver");
  await userEvent.click(trigger);
  await userEvent.click(page.getByRole("button", { name: "Use defaults" }));
  expect(state.updates).toEqual([
    {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, tokenSaver: null },
    },
  ]);
});

it("stays out of the composer until Token Saver is on, and for unsupported providers", async () => {
  setup({ enabled: false });
  await using screen = await render(
    <ComposerTokenSaverControl
      threadRef={threadRef}
      driver={ProviderDriverKind.make("claudeAgent")}
    />,
  );
  expect(screen.container.querySelector("button")).toBeNull();

  setup({});
  await screen.rerender(
    <ComposerTokenSaverControl
      threadRef={threadRef}
      driver={ProviderDriverKind.make("opencode")}
    />,
  );
  expect(screen.container.querySelector("button")).toBeNull();
});
