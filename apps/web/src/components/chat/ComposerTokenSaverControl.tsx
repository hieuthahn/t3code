import {
  AuthSettingsWriteScope,
  estimateTokenSaverSavingPercent,
  isTokenSaverConfigActive,
  TOKEN_SAVER_MIN_SAMPLE_TURNS,
  TOKEN_SAVER_OFF_CONFIG,
  tokenSaverPackShare,
  type ProviderDriverKind,
  type ScopedThreadRef,
  type TokenSaverConfig,
  type TokenSaverPack,
  type TokenSaverStats,
  type TokenSaverTurnSample,
} from "@t3tools/contracts";
import { LeafIcon } from "lucide-react";
import { useId, useState } from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { useThreadShell } from "~/state/entities";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, ComposerControlIcon, type ComposerControlSize } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";

/** Drivers whose adapter receives the rules; matches the server's TOKEN_SAVER_DRIVERS. */
const SUPPORTED_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent", "codex"]);

const CONCISE_LEVELS = [
  { level: "lite", label: "Lite" },
  { level: "full", label: "Full" },
  { level: "ultra", label: "Ultra" },
] as const;

const PACKS: ReadonlyArray<{
  readonly pack: TokenSaverPack;
  readonly title: string;
  readonly summary: string;
}> = [
  { pack: "concise", title: "Concise replies", summary: "Answer first, no filler, details kept." },
  { pack: "leanCode", title: "Lean code", summary: "Least code that works, no extras." },
  { pack: "quietTools", title: "Quiet tools", summary: "Targeted searches and line ranges." },
  { pack: "rtk", title: "RTK compression", summary: "Runs commands through rtk." },
];

const ESTIMATE_SOURCE =
  "Estimated share of a turn's tokens. Concise scales the Caveman project's reply benchmarks, RTK scales rtk's published command-output reduction, and Lean code and Quiet tools are our own estimates. Packs compound, so the total multiplies instead of adding.";

const isPackOn = (config: TokenSaverConfig, pack: TokenSaverPack) =>
  pack === "concise" ? config.concise !== "off" : config[pack];

const sameConfig = (left: TokenSaverConfig, right: TokenSaverConfig) =>
  left.concise === right.concise &&
  left.leanCode === right.leanCode &&
  left.quietTools === right.quietTools &&
  left.rtk === right.rtk;

/** A pack's own estimate, at the chosen concise level or Lite while concise is off. */
const packSharePercent = (config: TokenSaverConfig, pack: TokenSaverPack) =>
  Math.round(
    100 *
      tokenSaverPackShare(
        pack === "concise"
          ? {
              ...TOKEN_SAVER_OFF_CONFIG,
              concise: config.concise === "off" ? "lite" : config.concise,
            }
          : { ...TOKEN_SAVER_OFF_CONFIG, [pack]: true },
        pack,
      ),
  );

const formatTokens = (value: number) => Math.round(value).toLocaleString();

function measuredSavingPercent(comparison: TokenSaverStats["thread"]): number | null {
  const { on, off } = comparison;
  if (on.averageOutputTokens === null || off.averageOutputTokens === null) return null;
  if (off.averageOutputTokens === 0) return null;
  return Math.round((1 - on.averageOutputTokens / off.averageOutputTokens) * 100);
}

const signedPercent = (value: number) => (value >= 0 ? `−${value}%` : `+${-value}%`);

const compactTokens = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

function SampleCell(props: { readonly sample: TokenSaverTurnSample }) {
  const { sample } = props;
  if (sample.averageOutputTokens === null) {
    return (
      <span className="text-muted-foreground">
        Not enough data ({sample.turns}/{TOKEN_SAVER_MIN_SAMPLE_TURNS} turns)
      </span>
    );
  }
  return (
    <span className="grid">
      <span className="font-medium tabular-nums">
        {formatTokens(sample.averageOutputTokens)} out
      </span>
      <span className="text-muted-foreground tabular-nums">
        {sample.averageInputTokens === null
          ? null
          : `${compactTokens.format(sample.averageInputTokens)} in · `}
        {sample.turns} turns
      </span>
    </span>
  );
}

function StatsTable(props: { readonly stats: TokenSaverStats }) {
  const rows = [
    { scope: "This thread", comparison: props.stats.thread },
    { scope: "All threads", comparison: props.stats.overall },
  ];
  return (
    <div
      role="table"
      aria-label="Measured tokens per turn"
      className="grid grid-cols-[5rem_1fr_1fr] gap-x-3 gap-y-2 text-xs"
    >
      <div role="row" className="contents text-muted-foreground">
        <span role="columnheader">Measured</span>
        <span role="columnheader">Saver on</span>
        <span role="columnheader">Saver off</span>
      </div>
      {rows.map((row) => (
        <div key={row.scope} role="row" className="contents">
          <span role="rowheader" className="font-medium">
            {row.scope}
          </span>
          <span role="cell">
            <SampleCell sample={row.comparison.on} />
          </span>
          <span role="cell">
            <SampleCell sample={row.comparison.off} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** The thread's Token Saver packs, their estimated and measured saving; absent until enabled in settings. */
export function ComposerTokenSaverControl(props: {
  readonly threadRef: ScopedThreadRef;
  readonly driver: ProviderDriverKind;
  readonly size?: ComposerControlSize;
}) {
  const { environmentId, threadId } = props.threadRef;
  const size = props.size ?? "sm";
  const idPrefix = useId();
  const floatingLayerProps = useComposerMenuProps();
  const settings = useEnvironmentSettings(environmentId, (value) => value.tokenSaver);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const canWriteSettings = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const thread = useThreadShell(props.threadRef);
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata);
  const loadStats = useAtomCommand(orchestrationEnvironment.tokenSaverStats, {
    reportFailure: false,
  });
  const [draft, setDraft] = useState<TokenSaverConfig | null>(null);
  const [defaultsDraft, setDefaultsDraft] = useState<TokenSaverConfig | null>(null);
  const [stats, setStats] = useState<TokenSaverStats | null>(null);
  const [statsError, setStatsError] = useState(false);

  if (!settings.enabled || thread === null || !SUPPORTED_DRIVERS.has(props.driver)) return null;
  const defaults = defaultsDraft ?? settings.defaults;
  const config = draft ?? thread.tokenSaver ?? defaults;
  const rtkAvailable = stats?.rtkAvailable ?? false;
  const effective = rtkAvailable ? config : { ...config, rtk: false };
  const active = isTokenSaverConfigActive(effective);
  const estimate = estimateTokenSaverSavingPercent(effective, { rtk: rtkAvailable });
  const measured = stats === null ? null : measuredSavingPercent(stats.thread);
  // Before the first stats load the trigger counts the rtk pack as configured.
  const packsOn = PACKS.filter(({ pack }) =>
    isPackOn(stats === null ? config : effective, pack),
  ).length;

  const save = (next: TokenSaverConfig) => {
    setDraft(next);
    void updateMetadata({ environmentId, input: { threadId, tokenSaver: next } });
  };
  const togglePack = (pack: TokenSaverPack, on: boolean) =>
    save(
      pack === "concise"
        ? {
            ...config,
            concise: on ? (defaults.concise === "off" ? "lite" : defaults.concise) : "off",
          }
        : { ...config, [pack]: on },
    );
  const saveDefaults = (next: TokenSaverConfig) => {
    if (thread.tokenSaver === undefined || thread.tokenSaver === null) save(config);
    setDefaultsDraft(next);
    updateSettings({ tokenSaver: { defaults: next } });
  };
  const refreshStats = async () => {
    const result = await loadStats({ environmentId, input: { threadId } });
    if (result._tag === "Success") {
      setStats(result.value);
      setStatsError(false);
    } else {
      setStatsError(true);
    }
  };

  const rtkReason = statsError
    ? "Could not check for rtk"
    : stats === null
      ? "Checking for rtk…"
      : "rtk is not installed on this server";

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) return;
        setDraft(null);
        setDefaultsDraft(null);
        void refreshStats();
      }}
    >
      <PopoverTrigger
        render={
          <ComposerControl
            size={size}
            type="button"
            aria-label={packsOn > 0 ? `Token Saver: ${packsOn} on` : "Token Saver: off"}
          />
        }
      >
        <ComposerControlIcon icon={LeafIcon} size={size} />
        <span data-composer-control-label className="sr-only sm:not-sr-only">
          Saver
        </span>
        {packsOn > 0 ? (
          <span aria-hidden className="text-xs tabular-nums text-muted-foreground">
            {packsOn}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup {...floatingLayerProps} side="top" align="start" className="w-80">
        <div className="grid gap-3">
          <div className="flex items-start justify-between gap-3">
            <PopoverTitle>Token saver</PopoverTitle>
            <span id={`${idPrefix}-source`} className="sr-only">
              {ESTIMATE_SOURCE}
            </span>
            {active ? (
              <div role="status" className="grid justify-items-end text-xs tabular-nums">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        tabIndex={0}
                        className="rounded-sm font-medium text-success-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        aria-describedby={`${idPrefix}-source`}
                      />
                    }
                  >
                    {signedPercent(estimate)} est.
                  </TooltipTrigger>
                  <TooltipPopup className="max-w-64">{ESTIMATE_SOURCE}</TooltipPopup>
                </Tooltip>
                {measured === null ? null : (
                  <span className="text-muted-foreground">
                    {signedPercent(measured)} measured output
                  </span>
                )}
              </div>
            ) : (
              <span role="status" className="text-muted-foreground text-xs">
                Off
              </span>
            )}
          </div>

          <ul className="grid gap-2.5">
            {PACKS.map(({ pack, title, summary }) => {
              const missing = pack === "rtk" && !rtkAvailable;
              const on = isPackOn(effective, pack);
              const share = packSharePercent(config, pack);
              const labelId = `${idPrefix}-${pack}`;
              return (
                <li key={pack} className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="grid min-w-0 gap-0.5">
                      <div className="flex items-baseline gap-2">
                        <span id={labelId} className="font-medium text-sm">
                          {title}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          ~{share}% est.
                        </span>
                      </div>
                      <span
                        id={`${labelId}-about`}
                        className={
                          missing
                            ? "text-warning-foreground text-xs"
                            : "text-muted-foreground text-xs"
                        }
                      >
                        {missing ? rtkReason : summary}
                      </span>
                    </div>
                    <Switch
                      size="sm"
                      aria-labelledby={labelId}
                      aria-describedby={`${labelId}-about`}
                      checked={on}
                      disabled={missing}
                      onCheckedChange={(checked) => togglePack(pack, Boolean(checked))}
                    />
                  </div>
                  {pack === "concise" && on ? (
                    <ToggleGroup
                      aria-label="Concise level"
                      variant="segmented"
                      value={[config.concise]}
                      onValueChange={(next) => {
                        const level = CONCISE_LEVELS.find((option) => option.level === next[0]);
                        if (level !== undefined) save({ ...config, concise: level.level });
                      }}
                    >
                      {CONCISE_LEVELS.map((option) => (
                        <Toggle key={option.level} value={option.level}>
                          {option.label}
                        </Toggle>
                      ))}
                    </ToggleGroup>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="border-t pt-3">
            {stats !== null ? (
              <StatsTable stats={stats} />
            ) : statsError ? (
              <span className="text-destructive-foreground text-xs">
                Could not load measurements.
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">Loading measurements…</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t pt-3">
            <label className="flex min-w-0 items-center gap-2 whitespace-nowrap text-sm">
              <Checkbox
                checked={sameConfig(config, defaults)}
                disabled={!canWriteSettings}
                onCheckedChange={(checked) =>
                  saveDefaults(checked ? config : TOKEN_SAVER_OFF_CONFIG)
                }
              />
              Start new threads like this
            </label>
            <Button
              size="xs"
              variant="outline"
              disabled={!active}
              onClick={() => save(TOKEN_SAVER_OFF_CONFIG)}
            >
              Turn all off
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
