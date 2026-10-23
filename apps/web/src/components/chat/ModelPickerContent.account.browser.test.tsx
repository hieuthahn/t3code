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

vi.mock(import("~/hooks/useSettings"), async (original) => ({
  ...(await original()),
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
) {
  return (
    <ModelPickerContent
      environmentId={EnvironmentId.make("local")}
      activeInstanceId={ProviderInstanceId.make("claudeAgent_viet")}
      model={MODEL}
      lockedProvider={null}
      instanceEntries={entries}
      modelOptionsByInstance={
        new Map(entries.map((item) => [item.instanceId, [{ slug: MODEL, name: "Opus" }]]))
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
});
