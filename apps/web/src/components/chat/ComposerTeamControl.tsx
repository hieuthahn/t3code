import {
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ScopedThreadRef,
  type TeamProfile,
  type TeamSetup,
} from "@t3tools/contracts";
import { ChevronRightIcon, PlusIcon, UsersIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { randomUUID } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";
import { useEnvironmentScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import type { AppModelOption } from "../../modelSelection";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Textarea } from "../ui/textarea";
import { ComposerControl, ComposerControlIcon, type ComposerControlSize } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { TeamLimitsFields } from "./TeamLimitsFields";
import { TeamMemberPicker } from "./TeamMemberPicker";
import { TeamProfileBar } from "./TeamProfileBar";
import {
  canAddTeamWorker,
  initialTeamSetup,
  leadGuidanceBytesLeft,
  teamControlLabel,
  upsertTeamProfile,
} from "./teamSetupDraft";

/** Drivers whose adapter gives the architect its team rules; matches the server's TEAM_DRIVERS. */
const SUPPORTED_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent", "codex"]);
const NO_USAGE = { rounds: 0, assignments: 0 };

/** The thread's team: an architect model and the worker models it may delegate to. */
export function ComposerTeamControl(props: {
  readonly threadRef: ScopedThreadRef;
  readonly driver: ProviderDriverKind;
  readonly threadModel: ModelSelection;
  readonly lockedProvider: ProviderDriverKind | null;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  readonly size?: ComposerControlSize;
}) {
  const { environmentId, threadId } = props.threadRef;
  const size = props.size ?? "sm";
  const floatingLayerProps = useComposerMenuProps();
  const settings = useEnvironmentSettings(environmentId, (value) => value.team);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const thread = useThreadShell(props.threadRef);
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const canWriteSettings = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const [draft, setDraft] = useState<TeamSetup | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);

  if (thread === null || !SUPPORTED_DRIVERS.has(props.driver)) return null;
  const team = thread.team ?? null;
  const setup =
    draft ??
    initialTeamSetup({
      threadTeam: team,
      defaultSetup: settings.defaultSetup,
      threadModel: props.threadModel,
    });
  const edit = (next: TeamSetup) => setDraft(next);

  const apply = (next: TeamSetup | null) => {
    void updateMetadata({
      environmentId,
      input: {
        threadId,
        team: next,
        ...(next === null ? {} : { modelSelection: next.architect }),
      },
    });
    if (next !== null && canWriteSettings) updateSettings({ team: { defaultSetup: next } });
  };
  const saveProfiles = (profiles: ReadonlyArray<TeamProfile>) =>
    updateSettings({ team: { profiles: [...profiles] } });

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) setDraft(null);
      }}
    >
      <PopoverTrigger render={<ComposerControl size={size} type="button" aria-label="Team" />}>
        <ComposerControlIcon icon={UsersIcon} size={size} />
        <span data-composer-control-label className="sr-only sm:not-sr-only">
          {teamControlLabel(team)}
        </span>
      </PopoverTrigger>
      <PopoverPopup {...floatingLayerProps} side="top" align="start" className="w-96">
        <div className="grid gap-3">
          <PopoverTitle>Team</PopoverTitle>

          <TeamProfileBar
            profiles={settings.profiles}
            selectedId={profileId}
            canWrite={canWriteSettings}
            onSelect={(profile) => {
              setProfileId(profile.id);
              edit({ ...profile.setup });
            }}
            onSaveAs={(name) => {
              const profile = { id: randomUUID(), name, setup };
              saveProfiles(upsertTeamProfile(settings.profiles, profile));
              setProfileId(profile.id);
            }}
            onRename={(id, name) =>
              saveProfiles(
                settings.profiles.map((profile) =>
                  profile.id === id ? { ...profile, name } : profile,
                ),
              )
            }
            onDelete={(id) => {
              saveProfiles(settings.profiles.filter((profile) => profile.id !== id));
              setProfileId(null);
            }}
          />

          <section className="grid gap-1.5" aria-label="Architect">
            <span className="font-medium text-muted-foreground text-xs">Architect</span>
            <TeamMemberPicker
              label="Architect"
              environmentId={environmentId}
              member={setup.architect}
              lockedProvider={props.lockedProvider}
              instanceEntries={props.instanceEntries}
              modelOptionsByInstance={props.modelOptionsByInstance}
              disabled={!canOperate}
              onChange={(architect) => edit({ ...setup, architect })}
            />
          </section>

          <section className="grid gap-1.5" aria-label="Workers">
            <span className="font-medium text-muted-foreground text-xs">
              Workers {setup.workers.length}/6
            </span>
            {setup.workers.map((worker, index) => (
              <TeamMemberPicker
                // A worker seat has no identity beyond its position.
                // oxlint-disable-next-line react/no-array-index-key
                key={index}
                label={`Worker ${index + 1}`}
                environmentId={environmentId}
                member={worker}
                lockedProvider={null}
                instanceEntries={props.instanceEntries}
                modelOptionsByInstance={props.modelOptionsByInstance}
                disabled={!canOperate}
                onChange={(member) =>
                  edit({
                    ...setup,
                    workers: setup.workers.map((current, at) => (at === index ? member : current)),
                  })
                }
                {...(setup.workers.length > 1
                  ? {
                      onRemove: () =>
                        edit({ ...setup, workers: setup.workers.filter((_, at) => at !== index) }),
                    }
                  : {})}
              />
            ))}
            {canAddTeamWorker(setup) ? (
              <Button
                size="xs"
                variant="ghost"
                className="justify-self-start"
                disabled={!canOperate}
                onClick={() =>
                  edit({
                    ...setup,
                    workers: [...setup.workers, setup.workers.at(-1) ?? setup.architect],
                  })
                }
              >
                <PlusIcon className="size-3.5" />
                Add worker
              </Button>
            ) : null}
          </section>

          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <ChevronRightIcon className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
              Run limits
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="pt-2">
                <TeamLimitsFields
                  limits={setup.limits}
                  used={NO_USAGE}
                  disabled={!canOperate}
                  onChange={(limits) => edit({ ...setup, limits })}
                />
              </div>
            </CollapsiblePanel>
          </Collapsible>

          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <ChevronRightIcon className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
              Lead guidance
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="grid gap-1.5 pt-2">
                <Textarea
                  aria-label="Lead guidance"
                  placeholder="Added after the built-in architect rules."
                  value={setup.leadGuidance ?? ""}
                  disabled={!canOperate}
                  onChange={(event) => {
                    const { leadGuidance: _previous, ...rest } = setup;
                    const value = event.target.value;
                    edit(value.length === 0 ? rest : { ...rest, leadGuidance: value });
                  }}
                />
                <div className="flex items-center justify-between gap-2">
                  {leadGuidanceBytesLeft(setup.leadGuidance ?? "") < 200 ? (
                    <span className="text-xs text-warning-foreground" role="status">
                      {Math.max(0, leadGuidanceBytesLeft(setup.leadGuidance ?? ""))} bytes left
                    </span>
                  ) : (
                    <span />
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={!canOperate || setup.leadGuidance === undefined}
                    onClick={() => {
                      const { leadGuidance: _cleared, ...rest } = setup;
                      edit(rest);
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </div>
            </CollapsiblePanel>
          </Collapsible>

          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={settings.newThreads}
                disabled={!canWriteSettings}
                onCheckedChange={(checked) =>
                  updateSettings({ team: { newThreads: Boolean(checked), defaultSetup: setup } })
                }
              />
              Use for new threads
            </label>
            <div className="flex items-center gap-1.5">
              {team === null ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canOperate}
                  onClick={() => apply(null)}
                >
                  Single agent
                </Button>
              )}
              <Button size="sm" disabled={!canOperate} onClick={() => apply(setup)}>
                {team === null ? "Start team" : "Apply"}
              </Button>
            </div>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
