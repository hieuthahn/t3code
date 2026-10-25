import { Minimize2Icon } from "lucide-react";

import { cn } from "../../lib/utils";
import {
  type ContextBreakdownRow,
  type ContextWindowSnapshot,
  deriveContextBreakdownRows,
  formatContextWindowPercentage,
  formatContextWindowTokens,
} from "../../lib/contextWindow";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS } from "./threadDetailsPanelStyles";
import { formatContextWindowCompactionMessage } from "./ContextWindowMeter.logic";

const USED_SEGMENT_CLASSES = [
  "bg-sky-500",
  "bg-orange-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
] as const;

function segmentClass(row: ContextBreakdownRow, usedIndex: number) {
  if (row.kind === "free") return "bg-muted/60";
  if (row.kind === "buffer") return "bg-muted-foreground/35";
  return USED_SEGMENT_CLASSES[usedIndex % USED_SEGMENT_CLASSES.length];
}

function withSegmentClasses(rows: ReadonlyArray<ContextBreakdownRow>) {
  let usedIndex = 0;
  return rows.map((row) => ({
    row,
    className: segmentClass(row, row.kind === "used" ? usedIndex++ : usedIndex),
  }));
}

/** Context window use with Compact, split by category only when the provider reports one. */
export function ThreadContextPanel(props: {
  readonly usage: ContextWindowSnapshot | null;
  readonly onCompact?: (() => void) | undefined;
  readonly compactDisabled?: boolean | undefined;
  readonly compactDisabledReason?: string | null | undefined;
}) {
  const { usage } = props;
  if (usage === null) return null;
  const percentage = formatContextWindowPercentage(usage.usedPercentage);
  const hasWindow = usage.maxTokens !== null && percentage !== null;
  const barPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const segments = withSegmentClasses(deriveContextBreakdownRows(usage));
  const overloaded = barPercentage > 90;
  return (
    <ThreadDetailsSection
      headingId="thread-details-context-heading"
      title="Context"
      data-thread-context-panel
      actions={
        props.onCompact ? (
          <ThreadDetailsControl
            part="meta"
            aria-label="Compact context"
            disabled={props.compactDisabled}
            title={props.compactDisabled ? (props.compactDisabledReason ?? undefined) : undefined}
            onClick={props.onCompact}
          >
            <Minimize2Icon className="size-3" aria-hidden />
            Compact
          </ThreadDetailsControl>
        ) : undefined
      }
    >
      <div className={cn("flex flex-col gap-1.5 pb-1", THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS)}>
        <div className="flex items-baseline justify-between gap-3 text-sm tabular-nums">
          <span className="font-medium text-foreground/80">
            {hasWindow
              ? `${percentage} used`
              : `${formatContextWindowTokens(usage.usedTokens)} used`}
          </span>
          {hasWindow ? (
            <span className="text-2xs text-muted-foreground">
              {formatContextWindowTokens(usage.usedTokens)} /{" "}
              {formatContextWindowTokens(usage.maxTokens ?? null)}
            </span>
          ) : null}
        </div>
        {usage.maxTokens !== null ? (
          <div
            className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(barPercentage)}
            aria-label="Context window usage"
          >
            {segments.length > 0 ? (
              segments.map(({ row, className }) =>
                row.kind === "free" ? null : (
                  <div
                    key={row.name}
                    className={className}
                    style={{ width: `${row.percentage}%` }}
                  />
                ),
              )
            ) : (
              <div
                className={cn(
                  "h-full rounded-full",
                  overloaded ? "bg-destructive" : "bg-foreground/45",
                )}
                style={{ width: `${barPercentage}%` }}
              />
            )}
          </div>
        ) : null}
        {segments.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 pt-0.5">
            {segments.map(({ row, className }) => (
              <li
                key={row.name}
                className="flex items-center gap-2 text-2xs text-muted-foreground tabular-nums"
              >
                <span className={cn("size-2 shrink-0 rounded-sm", className)} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span>{formatContextWindowTokens(row.tokens)}</span>
                <span className="w-10 text-right">
                  {formatContextWindowPercentage(row.percentage)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {usage.compactsAutomatically ? (
          <p className="text-pretty text-2xs text-muted-foreground">
            {formatContextWindowCompactionMessage(null, usage.autoCompactThreshold)}
          </p>
        ) : null}
      </div>
    </ThreadDetailsSection>
  );
}
