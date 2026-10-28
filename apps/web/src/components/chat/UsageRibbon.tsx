import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { memo, useSyncExternalStore } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  deriveUsageRibbon,
  promptCacheExpiryMs,
  type UsageRibbonCache,
  type UsageRibbonWindow,
} from "./usageRibbon.logic";

const CACHE_TEXT = {
  warm: "Prompt cache is warm. The next message reads the conversation at the cached price.",
  cold: "Prompt cache expired. The next message re-reads the whole conversation at full price.",
} as const;

function RibbonWindow({ window }: { readonly window: UsageRibbonWindow }) {
  const summary = `${window.fullLabel}: ${window.percentLeft}% left${
    window.timeLeft === null ? "" : `, resets in ${window.timeLeft}`
  }`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={summary}
            className={cn("me-3 cursor-default", window.low && "text-warning")}
          />
        }
      >
        <span className="font-medium">{window.label}</span> {window.percentLeft}% left
        {window.timeLeft === null ? null : ` · ${window.timeLeft}`}
      </TooltipTrigger>
      <TooltipPopup side="top">{summary}</TooltipPopup>
    </Tooltip>
  );
}

function RibbonCache({ cache }: { readonly cache: UsageRibbonCache }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={CACHE_TEXT[cache.state]}
            className={cn("cursor-default", cache.state === "cold" && "text-warning")}
          />
        }
      >
        <span className="font-medium uppercase">{cache.state}</span>
        {cache.timeLeft === null ? null : ` ${cache.timeLeft} left`}
      </TooltipTrigger>
      <TooltipPopup side="top">{CACHE_TEXT[cache.state]}</TooltipPopup>
    </Tooltip>
  );
}

/** Minute-tick time that also re-renders the moment `boundaryMs` passes, so expiry is never late. */
function useClockMs(boundaryMs: number | null): number {
  const nowMinute = useNowMinute();
  const subscribe = (onChange: () => void) => {
    if (boundaryMs === null) return () => {};
    const delay = boundaryMs - Date.now();
    if (delay <= 0) return () => {};
    const timer = setTimeout(onChange, delay + 1);
    return () => clearTimeout(timer);
  };
  const passed = useSyncExternalStore(
    subscribe,
    () => boundaryMs !== null && Date.now() >= boundaryMs,
    () => false,
  );
  const minuteMs = Date.parse(`${nowMinute}:00.000Z`);
  return passed && boundaryMs !== null ? Math.max(minuteMs, boundaryMs) : minuteMs;
}

export const UsageRibbon = memo(function UsageRibbon(props: {
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly updatedAt: string | null | undefined;
  readonly promptCacheTtlMs: number | undefined;
  readonly promptCacheExpiresAt: string | undefined;
}) {
  const { windows, updatedAt, promptCacheTtlMs, promptCacheExpiresAt } = props;
  const nowMs = useClockMs(
    promptCacheExpiryMs({ updatedAt, promptCacheTtlMs, promptCacheExpiresAt }),
  );
  const ribbon = deriveUsageRibbon({
    windows,
    updatedAt,
    promptCacheTtlMs,
    promptCacheExpiresAt,
    nowMs,
  });
  if (ribbon === null) return null;
  return (
    <div
      data-chat-composer-usage-ribbon="true"
      className="min-w-0 truncate px-3 pb-1.5 text-2xs leading-4 whitespace-nowrap text-muted-foreground tabular-nums sm:px-4"
    >
      {ribbon.windows.length > 0 ? (
        <>
          <span className="me-3 font-medium tracking-wide uppercase opacity-70">Usage</span>
          {ribbon.windows.map((window) => (
            <RibbonWindow key={window.id} window={window} />
          ))}
        </>
      ) : null}
      {ribbon.cache === null ? null : <RibbonCache cache={ribbon.cache} />}
    </div>
  );
});
