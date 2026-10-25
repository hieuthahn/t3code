import type {
  ClaudeDesktopSyncApplyResult,
  ClaudeDesktopSyncItem,
  ClaudeDesktopSyncPreview,
  ClaudeDesktopSyncUndoResult,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ArrowLeftRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { claudeDesktopSyncRun } from "~/state/claudeDesktopSync";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Radio, RadioGroup } from "../ui/radio-group";
import { RefreshIcon } from "../ui/refresh-icon";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  archiveSide,
  filterCounts,
  groupSelection,
  groupSyncItems,
  groupsForFilter,
  isReadyToApply,
  SYNC_ACTION_VERBS,
  withGroupSelected,
  type SyncFilter,
  type SyncGroup,
  type SyncSide,
} from "./claudeDesktopSyncGroups";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly preview: ClaudeDesktopSyncPreview }
  | { readonly kind: "failed"; readonly message: string };

type Pending = { readonly kind: "applying"; readonly count: number } | { readonly kind: "undoing" };

export interface SyncOutcome {
  readonly tone: "success" | "warning" | "error";
  readonly title: string;
  readonly lines: ReadonlyArray<string>;
}

const FILTERS: ReadonlyArray<{ readonly id: SyncFilter; readonly label: string }> = [
  { id: "all", label: "All" },
  { id: "conflicts", label: "Conflicts" },
  { id: "toT3", label: "Into T3" },
  { id: "toDesktop", label: "Into Claude Desktop" },
];

const SIDE_LABELS: Record<SyncSide, string> = { desktop: "Claude Desktop", t3: "T3" };

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const failureMessage = (result: AtomCommandResult<unknown, unknown>) => {
  if (result._tag === "Success") return "The server returned no result.";
  const cause = squashAtomCommandFailure(result);
  return cause instanceof Error ? cause.message : "Could not reach the server.";
};

export function ClaudeDesktopSyncButton() {
  const environmentId = usePrimaryEnvironmentId();
  if (environmentId === null) return null;
  return <ClaudeDesktopSyncControl environmentId={environmentId} />;
}

function ClaudeDesktopSyncControl({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const session = useSyncSession(environmentId);
  return (
    <>
      <SidebarHeaderIconButton label="Sync with Claude Desktop" onClick={session.open}>
        <ArrowLeftRightIcon />
      </SidebarHeaderIconButton>
      {session.isOpen ? <ClaudeDesktopSyncDialog session={session} /> : null}
    </>
  );
}

export function describeApply(
  result: ClaudeDesktopSyncApplyResult,
  titleOf: (id: string) => string,
): SyncOutcome {
  const failures = result.failed.map((failure) => `${titleOf(failure.id)}: ${failure.error}`);
  const queued =
    result.queuedForDesktop > 0
      ? [
          `${plural(result.queuedForDesktop, "change")} ${result.queuedForDesktop === 1 ? "reaches" : "reach"} Claude Desktop after you quit and reopen it from the Dock.`,
        ]
      : [];
  if (failures.length === 0) {
    return { tone: "success", title: `Synced ${plural(result.applied, "change")}`, lines: queued };
  }
  if (result.applied === 0 && result.queuedForDesktop === 0) {
    return { tone: "error", title: `${plural(failures.length, "change")} failed`, lines: failures };
  }
  return {
    tone: "warning",
    title: `Synced ${result.applied}, ${failures.length} failed`,
    lines: [...queued, ...failures],
  };
}

export function describeUndo(result: ClaudeDesktopSyncUndoResult): SyncOutcome {
  const failures = result.failed.map((failure) => `${failure.id}: ${failure.error}`);
  return {
    tone: failures.length === 0 ? "success" : "warning",
    title: `Undid ${plural(result.undone, "change")}`,
    lines: failures,
  };
}

function useSyncSession(environmentId: EnvironmentId) {
  const run = useAtomCommand(claudeDesktopSyncRun, { reportFailure: false });
  const [isOpen, setIsOpen] = useState(false);
  const isOpenRef = useRef(false);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sides, setSides] = useState<ReadonlyMap<string, SyncSide>>(new Map());
  const [pending, setPending] = useState<Pending | null>(null);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);

  const load = async () => {
    const result = await run({ environmentId, input: { action: "preview" } });
    if (result._tag !== "Success" || result.value.preview === undefined) {
      setPhase({ kind: "failed", message: failureMessage(result) });
      return;
    }
    const preview = result.value.preview;
    setSelected(
      new Set(preview.items.filter((item) => item.selectedByDefault).map((item) => item.id)),
    );
    setSides(new Map());
    setPhase({ kind: "ready", preview });
  };

  const setOpen = (next: boolean) => {
    isOpenRef.current = next;
    setIsOpen(next);
  };

  const open = () => {
    setOpen(true);
    setPhase({ kind: "loading" });
    setOutcome(null);
    void load();
  };

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const announce = (next: SyncOutcome) => {
    setOutcome(next);
    if (isOpenRef.current) return;
    const description = next.lines.join(" ");
    toastManager.add({
      type: next.tone,
      title: next.title,
      ...(description === "" ? {} : { description }),
    });
  };

  const apply = async (items: ReadonlyArray<ClaudeDesktopSyncItem>) => {
    const titles = new Map(items.map((item) => [item.id, item.title || "Untitled"]));
    setPending({ kind: "applying", count: items.length });
    setOutcome(null);
    const result = await run({
      environmentId,
      input: {
        action: "apply",
        apply: {
          selectedIds: items.map((item) => item.id),
          conflictChoices: items.flatMap((item) => {
            const side = sides.get(item.id);
            return item.kind === "conflict" && side !== undefined ? [{ id: item.id, side }] : [];
          }),
        },
      },
    });
    await load();
    setPending(null);
    announce(
      result._tag === "Success" && result.value.apply !== undefined
        ? describeApply(result.value.apply, (id) => titles.get(id) ?? id)
        : { tone: "error", title: "Sync failed", lines: [failureMessage(result)] },
    );
  };

  const undo = async () => {
    setPending({ kind: "undoing" });
    setOutcome(null);
    const result = await run({ environmentId, input: { action: "undoLast" } });
    await load();
    setPending(null);
    announce(
      result._tag === "Success" && result.value.undoLast !== undefined
        ? describeUndo(result.value.undoLast)
        : { tone: "error", title: "Undo failed", lines: [failureMessage(result)] },
    );
  };

  return {
    isOpen,
    open,
    close: () => setOpen(false),
    phase,
    refreshing,
    refresh,
    selected,
    setSelected,
    sides,
    setSides,
    pending,
    outcome,
    dismissOutcome: () => setOutcome(null),
    apply,
    undo,
  };
}

export type SyncSession = Omit<ReturnType<typeof useSyncSession>, "isOpen" | "open">;

export function ClaudeDesktopSyncDialog({ session }: { readonly session: SyncSession }) {
  const { phase, selected, setSelected, sides, setSides, pending, outcome } = session;
  const [filter, setFilter] = useState<SyncFilter>("all");
  const statusRegion = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const items = phase.kind === "ready" ? phase.preview.items : [];
  const groups = groupSyncItems(items);
  const counts = filterCounts(groups);
  const activeFilter = counts[filter] === 0 ? "all" : filter;
  const visibleGroups = groupsForFilter(groups, activeFilter);
  const skipped = items.filter((item) => item.kind === "skip");
  const actionable = groups.flatMap((group) => group.items);
  const ready = actionable.filter((item) => isReadyToApply(item, selected, sides));
  const undecided = actionable.filter(
    (item) => item.kind === "conflict" && !sides.has(item.id),
  ).length;
  const busy = pending !== null;

  useEffect(() => {
    if (outcome !== null) statusRegion.current?.scrollIntoView({ block: "nearest" });
  }, [outcome]);

  const chooseSide = (item: ClaudeDesktopSyncItem, side: SyncSide) => {
    setSides(new Map(sides).set(item.id, side));
    setSelected(new Set(selected).add(item.id));
  };
  const chooseSideForAll = (group: SyncGroup, side: SyncSide) => {
    const next = new Map(sides);
    for (const item of group.items) next.set(item.id, side);
    setSides(next);
    setSelected(withGroupSelected(group, selected, true));
  };
  const toggleItem = (item: ClaudeDesktopSyncItem, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(item.id);
    else next.delete(item.id);
    setSelected(next);
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : session.close())}>
      <DialogPopup className="max-w-2xl" initialFocus={closeButton}>
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pe-8">
            <div className="grid gap-1">
              <DialogTitle>Sync with Claude Desktop</DialogTitle>
              <DialogDescription>
                {phase.kind === "ready"
                  ? `${plural(phase.preview.desktopSessionCount, "Claude Desktop session")} and ${plural(phase.preview.t3ThreadCount, "T3 thread")} compared.`
                  : phase.kind === "loading"
                    ? "Comparing Claude Desktop sessions with T3 threads."
                    : "The comparison did not finish."}
              </DialogDescription>
            </div>
            {phase.kind === "loading" ? null : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Compare again"
                      disabled={busy || session.refreshing}
                      onClick={() => void session.refresh()}
                    >
                      {session.refreshing ? <Spinner aria-hidden /> : <RefreshIcon />}
                    </Button>
                  }
                />
                <TooltipPopup>Compare again</TooltipPopup>
              </Tooltip>
            )}
          </div>
          {phase.kind === "ready" && counts.all > 0 ? (
            <ToggleGroup
              aria-label="Show changes"
              variant="segmented"
              className="mt-2 max-w-full overflow-x-auto"
              value={[activeFilter]}
              onValueChange={(next) => {
                const picked = FILTERS.find((option) => option.id === next[0]);
                if (picked !== undefined) setFilter(picked.id);
              }}
            >
              {FILTERS.filter((option) => option.id === "all" || counts[option.id] > 0).map(
                (option) => (
                  <Toggle
                    key={option.id}
                    value={option.id}
                    aria-label={`${option.label}, ${counts[option.id]}`}
                  >
                    <span className="flex items-center gap-1.5">
                      {option.label}
                      <span className="text-muted-foreground tabular-nums">
                        {counts[option.id]}
                      </span>
                    </span>
                  </Toggle>
                ),
              )}
            </ToggleGroup>
          ) : null}
        </DialogHeader>
        <DialogPanel>
          <div ref={statusRegion} aria-live="polite" className="empty:hidden">
            {pending !== null ? (
              <Alert variant="info">
                <Spinner aria-hidden />
                <AlertTitle>
                  {pending.kind === "applying"
                    ? `Applying ${plural(pending.count, "change")}…`
                    : "Undoing the last sync…"}
                </AlertTitle>
              </Alert>
            ) : outcome !== null ? (
              <OutcomeBanner
                outcome={outcome}
                canUndo={phase.kind === "ready" && phase.preview.canUndo}
                onUndo={() => void session.undo()}
                onDismiss={session.dismissOutcome}
              />
            ) : null}
          </div>
          {phase.kind === "ready" && phase.preview.pendingDesktopOpCount > 0 ? (
            <Alert variant="warning">
              <TriangleAlertIcon />
              <AlertTitle>
                {plural(phase.preview.pendingDesktopOpCount, "change")} waiting for Claude Desktop
              </AlertTitle>
              <AlertDescription>Quit Claude Desktop so they can be written.</AlertDescription>
            </Alert>
          ) : null}
          {phase.kind === "loading" ? (
            <LoadingRows />
          ) : phase.kind === "failed" ? (
            <Alert variant="error">
              <CircleAlertIcon />
              <AlertTitle>Could not compare the two apps</AlertTitle>
              <AlertDescription>{phase.message}</AlertDescription>
              <AlertAction>
                <Button size="compact" variant="outline" onClick={() => void session.refresh()}>
                  Try again
                </Button>
              </AlertAction>
            </Alert>
          ) : actionable.length === 0 ? (
            <InSyncNote />
          ) : (
            <div
              className={cn(
                "grid gap-4 transition-opacity",
                busy && "pointer-events-none opacity-60",
              )}
              aria-busy={busy}
            >
              {visibleGroups.map((group) => (
                <SyncGroupSection
                  key={group.id}
                  group={group}
                  selected={selected}
                  sides={sides}
                  onGroupChange={(on) => setSelected(withGroupSelected(group, selected, on))}
                  onItemChange={toggleItem}
                  onSideChange={chooseSide}
                  onSideForAll={(side) => chooseSideForAll(group, side)}
                />
              ))}
            </div>
          )}
          {skipped.length > 0 ? <SkippedList items={skipped} /> : null}
        </DialogPanel>
        <DialogFooter className="sm:items-center">
          <p className="text-muted-foreground text-xs tabular-nums sm:mr-auto" aria-live="polite">
            {phase.kind !== "ready" || actionable.length === 0 ? null : (
              <>
                {ready.length} of {actionable.length} ready
                {undecided > 0 ? (
                  <>
                    {" · "}
                    <span className="text-warning-foreground">
                      {plural(undecided, "conflict")} {undecided === 1 ? "needs" : "need"} a side
                    </span>
                  </>
                ) : null}
              </>
            )}
          </p>
          {phase.kind === "ready" && phase.preview.canUndo && outcome === null ? (
            <Button variant="ghost" disabled={busy} onClick={() => void session.undo()}>
              <RotateCcwIcon />
              Undo last sync
            </Button>
          ) : null}
          <Button ref={closeButton} variant="outline" onClick={session.close}>
            Close
          </Button>
          <Button disabled={busy || ready.length === 0} onClick={() => void session.apply(ready)}>
            {pending?.kind === "applying" ? <Spinner aria-hidden /> : null}
            {pending?.kind === "applying"
              ? "Applying…"
              : ready.length > 0
                ? `Apply ${ready.length}`
                : "Apply"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function OutcomeBanner({
  outcome,
  canUndo,
  onUndo,
  onDismiss,
}: {
  readonly outcome: SyncOutcome;
  readonly canUndo: boolean;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
}) {
  const Icon =
    outcome.tone === "success"
      ? CircleCheckIcon
      : outcome.tone === "warning"
        ? TriangleAlertIcon
        : CircleAlertIcon;
  return (
    <Alert variant={outcome.tone} controlAlignment="first-line">
      <Icon />
      <AlertTitle>{outcome.title}</AlertTitle>
      {outcome.lines.length === 0 ? null : (
        <AlertDescription>
          <ul className="grid gap-0.5">
            {outcome.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </AlertDescription>
      )}
      <AlertAction>
        {canUndo && outcome.tone !== "error" ? (
          <Button size="compact" variant="outline" onClick={onUndo}>
            <RotateCcwIcon />
            Undo
          </Button>
        ) : null}
        <Button size="compact" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </AlertAction>
    </Alert>
  );
}

function SyncGroupSection({
  group,
  selected,
  sides,
  onGroupChange,
  onItemChange,
  onSideChange,
  onSideForAll,
}: {
  readonly group: SyncGroup;
  readonly selected: ReadonlySet<string>;
  readonly sides: ReadonlyMap<string, SyncSide>;
  readonly onGroupChange: (on: boolean) => void;
  readonly onItemChange: (item: ClaudeDesktopSyncItem, on: boolean) => void;
  readonly onSideChange: (item: ClaudeDesktopSyncItem, side: SyncSide) => void;
  readonly onSideForAll: (side: SyncSide) => void;
}) {
  const headingId = `sync-group-${group.id}`;
  const selection = groupSelection(group, selected);
  const isConflicts = group.id === "conflicts";
  return (
    <section aria-labelledby={headingId} className="grid gap-1">
      <div className="flex min-h-8 items-center gap-2">
        {isConflicts ? null : (
          <Checkbox
            aria-label={`Select all in ${group.title}`}
            checked={selection === "all"}
            indeterminate={selection === "some"}
            onCheckedChange={(next) => onGroupChange(next === true)}
          />
        )}
        <h3 id={headingId} className="font-medium text-sm">
          {group.title}
        </h3>
        <span className="text-muted-foreground text-xs tabular-nums">{group.items.length}</span>
        {group.id === "archive" ? (
          <span className="text-muted-foreground text-xs">· off unless you pick them</span>
        ) : null}
        {isConflicts && group.items.length > 1 ? (
          <div className="ms-auto flex gap-1">
            <Button size="compact" variant="ghost" onClick={() => onSideForAll("desktop")}>
              Keep all Claude Desktop
            </Button>
            <Button size="compact" variant="ghost" onClick={() => onSideForAll("t3")}>
              Keep all T3
            </Button>
          </div>
        ) : null}
      </div>
      <ul className="grid gap-px">
        {group.items.map((item) =>
          item.kind === "conflict" ? (
            <ConflictRow
              key={item.id}
              item={item}
              side={sides.get(item.id)}
              onSideChange={(side) => onSideChange(item, side)}
            />
          ) : (
            <SyncRow
              key={item.id}
              item={item}
              checked={selected.has(item.id)}
              onCheckedChange={(on) => onItemChange(item, on)}
            />
          ),
        )}
      </ul>
    </section>
  );
}

function SyncRow({
  item,
  checked,
  onCheckedChange,
}: {
  readonly item: ClaudeDesktopSyncItem;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  const side = archiveSide(item);
  return (
    <li>
      <label className="-mx-2 flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-accent/60">
        <Checkbox
          className="mt-0.5"
          checked={checked}
          onCheckedChange={(next) => onCheckedChange(next === true)}
        />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="line-clamp-2 break-words font-medium text-foreground text-sm">
            {item.title || "Untitled"}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
            <Badge variant="outline" size="sm">
              {SYNC_ACTION_VERBS[item.kind]}
              {side === null ? null : ` in ${SIDE_LABELS[side]}`}
            </Badge>
            <span className="truncate">{item.detail}</span>
          </span>
        </span>
      </label>
    </li>
  );
}

function ConflictRow({
  item,
  side,
  onSideChange,
}: {
  readonly item: ClaudeDesktopSyncItem;
  readonly side: SyncSide | undefined;
  readonly onSideChange: (side: SyncSide) => void;
}) {
  const field = item.conflictField === "archived" ? "Archive state" : "Title";
  return (
    <li className="grid gap-2 py-2">
      <p className="grid gap-0.5">
        <span className="truncate font-medium text-sm">{item.title || "Untitled"}</span>
        <span className="text-muted-foreground text-xs">
          {field} changed in both apps. Pick the one to keep.
        </span>
      </p>
      <RadioGroup
        aria-label={`Keep which ${field.toLowerCase()} for ${item.title || "Untitled"}`}
        className="sm:grid sm:grid-cols-2"
        value={side ?? null}
        onValueChange={(next) => {
          if (next === "desktop" || next === "t3") onSideChange(next);
        }}
      >
        <SideCard value="desktop" label={SIDE_LABELS.desktop} text={item.desktopValue} />
        <SideCard value="t3" label={SIDE_LABELS.t3} text={item.t3Value} />
      </RadioGroup>
    </li>
  );
}

function SideCard({
  value,
  label,
  text,
}: {
  readonly value: SyncSide;
  readonly label: string;
  readonly text: string | undefined;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-input px-3 py-2.5 transition-colors hover:bg-accent/60 has-data-checked:border-primary has-data-checked:bg-primary/6">
      <Radio value={value} className="mt-0.5" />
      <span className="grid min-w-0 gap-0.5">
        <span className="text-muted-foreground text-xs">Keep {label}</span>
        <span className="line-clamp-2 break-words text-foreground text-sm">{text || "Empty"}</span>
      </span>
    </label>
  );
}

function SkippedList({ items }: { readonly items: ReadonlyArray<ClaudeDesktopSyncItem> }) {
  return (
    <details className="text-muted-foreground text-xs">
      <summary className="cursor-pointer select-none py-1 hover:text-foreground">
        {plural(items.length, "session")} skipped
      </summary>
      <ul className="mt-1 grid gap-1 ps-4">
        {items.map((item) => (
          <li key={item.id} className="grid">
            <span className="truncate text-foreground">{item.title || item.id}</span>
            <span>{item.detail}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function InSyncNote() {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <CircleCheckIcon className="size-6 text-success" aria-hidden />
      <p className="font-medium text-sm">Everything is in sync</p>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="grid gap-3" role="status" aria-label="Comparing sessions">
      <Skeleton className="h-4 w-28" />
      {[72, 56, 64, 48].map((width) => (
        <div key={width} className="flex items-start gap-2.5">
          <Skeleton className="size-4" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
