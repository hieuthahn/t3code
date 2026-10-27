import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { ModelPickerContent } from "./ModelPickerContent";

const updateEnvironmentSettings = vi.hoisted(() => vi.fn());

vi.mock(import("~/hooks/useSettings"), async (original) => ({
  ...(await original()),
  useUpdateEnvironmentSettings: (() => updateEnvironmentSettings) as never,
  useModelPickerMergeAccounts: (() => true) as never,
  useToggleEnvironmentModelFavorite: (() => vi.fn()) as never,
}));

const GROUP = "claude:home:/shared";
const MODEL = "claude-opus-5-5";

const entry = (instanceId: string, email: string): ProviderInstanceEntry => {
  const models = [{ slug: MODEL, name: "Opus", isCustom: false, capabilities: {} }];
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driverKind: ProviderDriverKind.make("claudeAgent"),
    displayName: email,
    continuationGroupKey: GROUP,
    enabled: true,
    installed: true,
    status: "ready",
    isDefault: instanceId === "claudeAgent",
    isAvailable: true,
    models,
    snapshot: {
      instanceId: ProviderInstanceId.make(instanceId),
      driver: "claudeAgent",
      enabled: true,
      installed: true,
      status: "ready",
      auth: { status: "authenticated", email },
      models,
      continuation: { groupKey: GROUP },
    } as unknown as ServerProvider,
  } as ProviderInstanceEntry;
};

const entries = [
  entry("claudeAgent", "hieu@example.test"),
  entry("claudeAgent_viet", "viet@example.test"),
];

function picker(
  onAccountChoiceChange: (
    instanceId: ProviderInstanceId,
    model: string,
    accountChoice: "auto" | "pinned",
  ) => void,
  pinned = false,
  modelOnlyOn?: string,
) {
  return (
    <ModelPickerContent
      environmentId={EnvironmentId.make("local")}
      activeInstanceId={ProviderInstanceId.make("claudeAgent_viet")}
      model={MODEL}
      lockedProvider={null}
      instanceEntries={entries}
      modelOptionsByInstance={
        new Map(
          entries.map((item) => [
            item.instanceId,
            modelOnlyOn === undefined || item.instanceId === modelOnlyOn
              ? [{ slug: MODEL, name: "Opus" }]
              : [],
          ]),
        )
      }
      terminalOpen={false}
      onInstanceModelChange={vi.fn()}
      onAccountChoiceChange={onAccountChoiceChange}
      {...(pinned ? { activeAccountPinned: true } : {})}
    />
  );
}

const accountButton = (label: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Account for this thread"] button',
    ),
  ].find((button) => button.textContent?.trim() === label)!;

describe("ModelPickerContent account footer", () => {
  it("applies an account pick and Auto to the active model without picking a model again", async () => {
    const onAccountChoiceChange = vi.fn();
    await using _screen = await render(picker(onAccountChoiceChange));
    await userEvent.click(accountButton("hieu"));
    expect(onAccountChoiceChange).toHaveBeenLastCalledWith(
      ProviderInstanceId.make("claudeAgent"),
      MODEL,
      "pinned",
    );
    await userEvent.click(accountButton("Auto"));
    expect(onAccountChoiceChange).toHaveBeenLastCalledWith(
      ProviderInstanceId.make("claudeAgent_viet"),
      MODEL,
      "auto",
    );
  });

  it("opens on the pinned account", async () => {
    await using _screen = await render(picker(vi.fn(), true));
    expect(accountButton("viet").getAttribute("aria-pressed")).toBe("true");
    expect(accountButton("Auto").getAttribute("aria-pressed")).toBe("false");
  });

  it("saves each pick as the default account of the active provider only", async () => {
    updateEnvironmentSettings.mockClear();
    await using _screen = await render(picker(vi.fn()));
    await userEvent.click(accountButton("hieu"));
    expect(updateEnvironmentSettings).toHaveBeenLastCalledWith({
      defaultAccountByDriver: { claudeAgent: ProviderInstanceId.make("claudeAgent") },
    });
    await userEvent.click(accountButton("Auto"));
    expect(updateEnvironmentSettings).toHaveBeenLastCalledWith({
      defaultAccountByDriver: { claudeAgent: "auto" },
    });
    expect(updateEnvironmentSettings).toHaveBeenCalledTimes(2);
  });

  it("changes nothing when the active model is unavailable on the picked account", async () => {
    updateEnvironmentSettings.mockClear();
    const onAccountChoiceChange = vi.fn();
    await using _screen = await render(picker(onAccountChoiceChange, false, "claudeAgent_viet"));
    await userEvent.click(accountButton("hieu"));
    expect(updateEnvironmentSettings).not.toHaveBeenCalled();
    expect(onAccountChoiceChange).not.toHaveBeenCalled();
    expect(accountButton("hieu").getAttribute("aria-pressed")).toBe("false");
    expect(accountButton("Auto").getAttribute("aria-pressed")).toBe("true");
  });
});
