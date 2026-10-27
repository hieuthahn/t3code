import {
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ScopedThreadRef,
  type TeamProfile,
  type TeamSetup,
  teamLimitChangeProblems,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { ChevronRightIcon, PlusIcon, UsersIcon, XIcon } from "lucide-react";
import { useState } from "react";

import {
  updateDraftComposerSettings,
  useDraftComposerSettings,
} from "~/draftComposerSettingsStore";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { randomUUID } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import type { AppModelOption } from "../../modelSelection";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Popover, PopoverClose, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { ComposerControl, ComposerControlIcon, type ComposerControlSize } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { TeamLimitsFields } from "./TeamLimitsFields";
import { TeamMemberPicker } from "./TeamMemberPicker";
import { TeamProfileBar } from "./TeamProfileBar";
import {
  canAddTeamWorker,
  decidedTeam,
  draftTeam,
  initialTeamSetup,
  leadGuidanceBytesLeft,
  teamControlName,
  upsertTeamProfile,
} from "./teamSetupDraft";

/** Drivers whose adapter gives the architect its team rules; matches the server's TEAM_DRIVERS. */
const SUPPORTED_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent", "codex"]);
const NO_USAGE = { rounds: 0, assignments: 0 };

/** The thread's team: an architect model and the worker models it may delegate to. */
export function ComposerTeamControl(props: {
  readonly threadRef: ScopedThreadRef;
  /** Set on a draft route: the team waits in the draft until the first send creates the thread. */
  readonly isDraft?: boolean;
  /** Moves the draft's model to the architect it starts the team with. */
  readonly onDraftArchitect?: (architect: ModelSelection) => void;
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
  const isDraft = props.isDraft === true;
  const threadKey = scopedThreadKey(props.threadRef);
  const draftSettings = useDraftComposerSettings(isDraft ? threadKey : null);
  const thread = useThreadShell(isDraft ? null : props.threadRef);
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const canWriteSettings = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const [draft, setDraft] = useState<TeamSetup | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const runQuery = useEnvironmentQuery(
    isDraft || thread?.team === undefined
      ? null
      : serverEnvironment.teamLive({ environmentId, input: { threadId } }),
  );

  if ((!isDraft && thread === null) || !SUPPORTED_DRIVERS.has(props.driver)) return null;
  const choice = isDraft ? draftTeam(draftSettings.team, settings) : (thread?.team ?? null);
  const team = decidedTeam(choice);
  const isAuto = choice === "auto";
  const setup =
    draft ??
    initialTeamSetup({
      threadTeam: team,
      defaultSetup: settings.defaultSetup,
      threadModel: props.threadModel,
    });
  const edit = (next: TeamSetup) => setDraft(next);
  const run = runQuery.data;
  const used =
    run !== null &&
    (run.status === "running" || run.status === "paused" || run.status === "interrupted")
      ? run.usage
      : NO_USAGE;
  const limitProblems = team === null ? [] : teamLimitChangeProblems(setup.limits, used);

  const apply = async (next: TeamSetup | null) => {
    if (isDraft) {
      updateDraftComposerSettings(threadKey, { team: next });
      if (next !== null) {
        props.onDraftArchitect?.(next.architect);
        if (canWriteSettings) updateSettings({ team: { defaultSetup: next } });
      }
      setApplyError(null);
      setOpen(false);
      return;
    }
    setApplying(true);
    setApplyError(null);
    const result = await updateMetadata({
      environmentId,
      input: {
        threadId,
        team: next,
        ...(next === null ? {} : { modelSelection: next.architect }),
      },
    });
    setApplying(false);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      setApplyError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (next !== null && canWriteSettings) updateSettings({ team: { defaultSetup: next } });
    setOpen(false);
  };
  const setAuto = (on: boolean) => {
    updateDraftComposerSettings(threadKey, { team: on ? "auto" : undefined });
    if (canWriteSettings) updateSettings({ team: { autoNewThreads: on } });
  };
  const autoTeamName =
    settings.defaultSetup === null
      ? undefined
      : settings.profiles.find(
          (profile) => JSON.stringify(profile.setup) === JSON.stringify(settings.defaultSetup),
        )?.name;
  const saveProfiles = (profiles: ReadonlyArray<TeamProfile>) =>
    updateSettings({ team: { profiles: [...profiles] } });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(null);
          setApplyError(null);
        }
      }}
    >
      <PopoverTrigger
        render={
          <ComposerControl
            size={size}
            type="button"
            aria-label={teamControlName(choice)}
            aria-pressed={choice !== null}
            className="aria-pressed:font-semibold"
          />
        }
      >
        <ComposerControlIcon
          icon={UsersIcon}
          size={size}
          {...(choice === null ? {} : { className: "text-foreground" })}
        />
        <span data-composer-control-label className="sr-only sm:not-sr-only">
          Team
        </span>
        {isAuto ? (
          <span
            aria-hidden="true"
            className="rounded-full border border-foreground/40 px-1.5 text-2xs text-foreground"
          >
            Auto
          </span>
        ) : team === null ? null : (
          <span
            aria-hidden="true"
            className="min-w-4 rounded-full bg-foreground px-1 text-center text-2xs text-background tabular-nums"
          >
            {team.workers.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverPopup {...floatingLayerProps} side="top" align="start" className="w-md">
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <PopoverTitle>Architect & workers</PopoverTitle>
            <PopoverClose render={<Button size="icon-xs" variant="ghost" />} aria-label="Close">
              <XIcon className="size-3.5" />
            </PopoverClose>
          </div>

          {isDraft ? (
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="grid gap-0.5">
                <span>Auto</span>
                <span className="text-xs text-muted-foreground">
                  {settings.defaultSetup === null
                    ? "Start a team once to give Auto a default team."
                    : `Each message decides between ${autoTeamName ?? "the default team"} and a single agent.`}
                </span>
              </span>
              <Switch
                size="sm"
                checked={isAuto}
                disabled={settings.defaultSetup === null}
                onCheckedChange={(checked) => setAuto(Boolean(checked))}
              />
            </label>
          ) : null}

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
            <span className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-muted-foreground">Architect</span>
              <span className="text-muted-foreground">Plans & reviews</span>
            </span>
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
              // A worker seat has no identity beyond its position.
              // oxlint-disable-next-line react/no-array-index-key
              <div key={index} className="flex min-w-0 items-center gap-2">
                <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">
                  Worker {index + 1}
                </span>
                <TeamMemberPicker
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
                      workers: setup.workers.map((current, at) =>
                        at === index ? member : current,
                      ),
                    })
                  }
                  {...(setup.workers.length > 1
                    ? {
                        onRemove: () =>
                          edit({
                            ...setup,
                            workers: setup.workers.filter((_, at) => at !== index),
                          }),
                      }
                    : {})}
                />
              </div>
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

          <label className="flex items-center justify-between gap-3 text-sm">
            Start assignments without approval
            <Switch
              size="sm"
              checked={setup.autonomous === true}
              disabled={!canOperate}
              onCheckedChange={(checked) => {
                const { autonomous: _previous, ...rest } = setup;
                edit(checked ? { ...rest, autonomous: true } : rest);
              }}
            />
          </label>

          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <ChevronRightIcon className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
              Run limits & context
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="pt-2">
                <TeamLimitsFields
                  limits={setup.limits}
                  used={used}
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

          {applyError === null ? null : (
            <p role="alert" className="text-xs text-destructive">
              Could not apply the team: {applyError}
            </p>
          )}

          {limitProblems.length === 0 ? null : (
            <p role="alert" className="text-xs text-destructive">
              {limitProblems.join(" ")}
            </p>
          )}

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

          <div className="flex items-center justify-between gap-3 border-t pt-3">
            {choice === null ? (
              <span />
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={!canOperate || applying}
                onClick={() => void apply(null)}
              >
                Use a single agent
              </Button>
            )}
            <Button
              size="sm"
              disabled={!canOperate || applying || limitProblems.length > 0}
              onClick={() => void apply(setup)}
            >
              {team === null ? "Start team" : "Save setup"}
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
