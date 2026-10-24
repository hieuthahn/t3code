import {
  DEFAULT_TEAM_LIMITS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type TeamSetup,
} from "@t3tools/contracts";
import { page, userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { TeamModelsTooltip } from "./TeamModelsTooltip";
import { teamModelSuffix } from "./teamSetupDraft";

const entry = (
  instanceId: string,
  driver: string,
  models: ReadonlyArray<{ slug: string; name: string }>,
): ProviderInstanceEntry => {
  const serverModels = models.map((model) => ({ ...model, isCustom: false, capabilities: {} }));
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driverKind: ProviderDriverKind.make(driver),
    displayName: instanceId,
    enabled: true,
    installed: true,
    status: "ready",
    isDefault: true,
    isAvailable: true,
    models: serverModels,
    snapshot: {
      instanceId: ProviderInstanceId.make(instanceId),
      driver,
      enabled: true,
      installed: true,
      status: "ready",
      auth: { status: "authenticated" },
      models: serverModels,
    } as unknown as ServerProvider,
  } as ProviderInstanceEntry;
};

const claudeModels = [{ slug: "claude-opus-5-5", name: "Opus 5.5" }];
const codexModels = [{ slug: "gpt-5-codex", name: "GPT-5 Codex" }];
const entries = [
  entry("claudeAgent", "claudeAgent", claudeModels),
  entry("codex", "codex", codexModels),
];
const modelOptionsByInstance = new Map([
  [ProviderInstanceId.make("claudeAgent"), claudeModels],
  [ProviderInstanceId.make("codex"), codexModels],
]);
const architect = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-opus-5-5" };
const worker = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" };
const team: TeamSetup = { architect, workers: [worker, worker], limits: DEFAULT_TEAM_LIMITS };

it("shows the architect with the count of other worker models and lists the team on hover", async () => {
  await using _screen = await render(
    <ProviderModelPicker
      environmentId={EnvironmentId.make("local")}
      activeInstanceId={architect.instanceId}
      model={architect.model}
      lockedProvider={null}
      instanceEntries={entries}
      modelOptionsByInstance={modelOptionsByInstance}
      triggerSuffix={teamModelSuffix(team, architect) ?? undefined}
      triggerTooltip={
        <TeamModelsTooltip team={team} modelOptionsByInstance={modelOptionsByInstance} />
      }
      onInstanceModelChange={vi.fn()}
    />,
  );
  const trigger = page.getByRole("button", { name: "Opus 5.5 +1 model" });
  await expect.element(trigger).toBeVisible();
  await userEvent.hover(page.getByText("+1 model"));
  await expect.element(page.getByText("Architect · Opus 5.5")).toBeVisible();
  await expect.element(page.getByText("Worker 1 · GPT-5 Codex")).toBeVisible();
  await expect.element(page.getByText("Worker 2 · GPT-5 Codex")).toBeVisible();
});
