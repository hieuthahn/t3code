import {
  isTokenSaverConfigActive,
  TOKEN_SAVER_MIN_SAMPLE_TURNS,
  type ProviderDriverKind,
  type ScopedThreadRef,
  type TokenSaverConciseLevel,
  type TokenSaverConfig,
  type TokenSaverStats,
  type TokenSaverTurnSample,
} from "@t3tools/contracts";
import { FeatherIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useThreadShell } from "~/state/entities";
import { orchestrationEnvironment } from "~/state/orchestration";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { ComposerControl, ComposerControlIcon, type ComposerControlSize } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";

/** Drivers whose adapter receives the rules; matches the server's TOKEN_SAVER_DRIVERS. */
const SUPPORTED_DRIVERS: ReadonlySet<string> = new Set(["claudeAgent", "codex"]);

const CONCISE_LABELS: Record<TokenSaverConciseLevel, string> = {
  off: "Off",
  lite: "Lite",
  full: "Full",
  ultra: "Ultra",
};

function tokenSaverControlLabel(config: TokenSaverConfig): string {
  if (!isTokenSaverConfigActive(config)) return "Saver off";
  return config.concise === "off" ? "Saver" : CONCISE_LABELS[config.concise];
}

const formatTokens = (value: number) => Math.round(value).toLocaleString();

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
    <span className="tabular-nums">
      {formatTokens(sample.averageOutputTokens)} out
      {sample.averageInputTokens === null
        ? null
        : ` · ${formatTokens(sample.averageInputTokens)} in`}
      <span className="text-muted-foreground"> · {sample.turns} turns</span>
    </span>
  );
}

function StatsTable(props: { readonly stats: TokenSaverStats }) {
  const rows = [
    { scope: "This thread", comparison: props.stats.thread },
    { scope: "All threads", comparison: props.stats.overall },
  ];
  return (
    <div className="grid gap-2 text-xs" aria-label="Average tokens per turn">
      <div className="font-medium text-muted-foreground">Average tokens per turn</div>
      {rows.map((row) => (
        <div key={row.scope} className="grid gap-0.5">
          <div className="font-medium">{row.scope}</div>
          <div className="grid grid-cols-[2.5rem_1fr] gap-x-2 gap-y-0.5">
            <span className="text-muted-foreground">On</span>
            <SampleCell sample={row.comparison.on} />
            <span className="text-muted-foreground">Off</span>
            <SampleCell sample={row.comparison.off} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The thread's Token Saver packs and their measured effect; absent until enabled in settings. */
export function ComposerTokenSaverControl(props: {
  readonly threadRef: ScopedThreadRef;
  readonly driver: ProviderDriverKind;
  readonly size?: ComposerControlSize;
}) {
  const size = props.size ?? "sm";
  const floatingLayerProps = useComposerMenuProps();
  const settings = useEnvironmentSettings(
    props.threadRef.environmentId,
    (value) => value.tokenSaver,
  );
  const thread = useThreadShell(props.threadRef);
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata);
  const loadStats = useAtomCommand(orchestrationEnvironment.tokenSaverStats, {
    reportFailure: false,
  });
  const [stats, setStats] = useState<TokenSaverStats | null>(null);
  const [statsError, setStatsError] = useState(false);

  if (!settings.enabled || thread === null || !SUPPORTED_DRIVERS.has(props.driver)) return null;
  const override = thread.tokenSaver ?? null;
  const config = override ?? settings.defaults;

  const save = (next: TokenSaverConfig | null) =>
    void updateMetadata({
      environmentId: props.threadRef.environmentId,
      input: { threadId: props.threadRef.threadId, tokenSaver: next },
    });
  const refreshStats = async () => {
    const result = await loadStats({
      environmentId: props.threadRef.environmentId,
      input: { threadId: props.threadRef.threadId },
    });
    if (result._tag === "Success") {
      setStats(result.value);
      setStatsError(false);
    } else {
      setStatsError(true);
    }
  };

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) void refreshStats();
      }}
    >
      <PopoverTrigger
        render={<ComposerControl size={size} type="button" aria-label="Token Saver" />}
      >
        <ComposerControlIcon icon={FeatherIcon} size={size} />
        <span data-composer-control-label className="sr-only sm:not-sr-only">
          {tokenSaverControlLabel(config)}
        </span>
      </PopoverTrigger>
      <PopoverPopup {...floatingLayerProps} side="top" align="start" className="w-80">
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <PopoverTitle>Token Saver</PopoverTitle>
            {override === null ? (
              <span className="text-muted-foreground text-xs">Using defaults</span>
            ) : (
              <Button size="xs" variant="ghost" onClick={() => save(null)}>
                Use defaults
              </Button>
            )}
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium" id="token-saver-concise-label">
              Concise replies
            </span>
            <ToggleGroup
              aria-labelledby="token-saver-concise-label"
              variant="segmented"
              value={[config.concise]}
              onValueChange={(next) => {
                const concise = next[0];
                if (
                  concise === "off" ||
                  concise === "lite" ||
                  concise === "full" ||
                  concise === "ultra"
                )
                  save({ ...config, concise });
              }}
            >
              {(["off", "lite", "full", "ultra"] as const).map((level) => (
                <Toggle key={level} value={level}>
                  {CONCISE_LABELS[level]}
                </Toggle>
              ))}
            </ToggleGroup>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Lean code
            <Switch
              size="sm"
              checked={config.leanCode}
              onCheckedChange={(checked) => save({ ...config, leanCode: Boolean(checked) })}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Quiet tools
            <Switch
              size="sm"
              checked={config.quietTools}
              onCheckedChange={(checked) => save({ ...config, quietTools: Boolean(checked) })}
            />
          </label>
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
        </div>
      </PopoverPopup>
    </Popover>
  );
}
