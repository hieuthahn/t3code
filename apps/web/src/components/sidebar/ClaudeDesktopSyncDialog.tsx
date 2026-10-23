import type {
  ClaudeDesktopSyncApplyResult,
  ClaudeDesktopSyncItem,
  ClaudeDesktopSyncItemKind,
  ClaudeDesktopSyncPreview,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ArrowLeftRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { claudeDesktopSyncRun } from "~/state/claudeDesktopSync";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
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
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

const ACTION_LABELS: Record<ClaudeDesktopSyncItemKind, string> = {
  importToT3: "Import into T3",
  createInDesktop: "Add to Claude Desktop",
  renameT3: "Rename in T3",
  renameDesktop: "Rename in Claude Desktop",
  archiveT3: "Update in T3",
  archiveDesktop: "Update in Claude Desktop",
  suggestArchiveT3: "Archive in T3",
  suggestArchiveDesktop: "Archive in Claude Desktop",
  conflict: "Changed on both sides",
  skip: "Skipped",
};

type Side = "desktop" | "t3";

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly preview: ClaudeDesktopSyncPreview }
  | { readonly kind: "failed"; readonly message: string };

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

function useSyncSession(environmentId: EnvironmentId) {
  const run = useAtomCommand(claudeDesktopSyncRun, { reportFailure: false });
  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sides, setSides] = useState<ReadonlyMap<string, Side>>(new Map());
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ReadonlyArray<string> | null>(null);

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

  const open = () => {
    setIsOpen(true);
    setPhase({ kind: "loading" });
    setOutcome(null);
    void load();
  };

  const apply = async () => {
    setBusy(true);
    const result = await run({
      environmentId,
      input: {
        action: "apply",
        apply: {
          selectedIds: [...selected],
          conflictChoices: [...sides].map(([id, side]) => ({ id, side })),
        },
      },
    });
    setBusy(false);
    setOutcome(
      result._tag === "Success" && result.value.apply !== undefined
        ? describeApply(result.value.apply)
        : [`Sync failed: ${failureMessage(result)}`],
    );
    await load();
  };

  const undo = async () => {
    setBusy(true);
    const result = await run({ environmentId, input: { action: "undoLast" } });
    setBusy(false);
    setOutcome(
      result._tag === "Success" && result.value.undoLast !== undefined
        ? [
            `Undid ${result.value.undoLast.undone} ${result.value.undoLast.undone === 1 ? "change" : "changes"}.`,
            ...result.value.undoLast.failed.map((failure) => `${failure.id}: ${failure.error}`),
          ]
        : [`Undo failed: ${failureMessage(result)}`],
    );
    await load();
  };

  return {
    isOpen,
    open,
    close: () => setIsOpen(false),
    phase,
    selected,
    setSelected,
    sides,
    setSides,
    busy,
    outcome,
    apply,
    undo,
  };
}

function ClaudeDesktopSyncDialog({
  session,
}: {
  readonly session: ReturnType<typeof useSyncSession>;
}) {
  const { phase, selected, setSelected, sides, setSides, busy, outcome } = session;
  const items = phase.kind === "ready" ? phase.preview.items : [];
  const actionable = items.filter((item) => item.kind !== "skip");
  const skipped = items.filter((item) => item.kind === "skip");
  const ready = [...selected].filter((id) => {
    const item = actionable.find((candidate) => candidate.id === id);
    return item !== undefined && (item.kind !== "conflict" || sides.has(id));
  });

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : session.close())}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Sync with Claude Desktop</DialogTitle>
          {phase.kind === "ready" ? (
            <DialogDescription>
              {phase.preview.desktopSessionCount} Claude Desktop sessions,{" "}
              {phase.preview.t3ThreadCount} T3 threads.
              {phase.preview.pendingDesktopOpCount > 0
                ? ` ${phase.preview.pendingDesktopOpCount} changes wait for a closed Claude Desktop app.`
                : ""}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogPanel>
          {phase.kind === "loading" ? (
            <WaitingNote label="Reading Claude Desktop sessions and transcripts" />
          ) : phase.kind === "failed" ? (
            <p className="text-sm text-destructive-foreground">{phase.message}</p>
          ) : actionable.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everything is in sync.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {actionable.map((item) => (
                <SyncRow
                  key={item.id}
                  item={item}
                  checked={selected.has(item.id)}
                  side={sides.get(item.id)}
                  onCheckedChange={(checked) => {
                    const next = new Set(selected);
                    if (checked) next.add(item.id);
                    else next.delete(item.id);
                    setSelected(next);
                  }}
                  onSideChange={(side) => {
                    setSides(new Map(sides).set(item.id, side));
                    setSelected(new Set(selected).add(item.id));
                  }}
                />
              ))}
            </ul>
          )}
          {skipped.length > 0 ? (
            <details className="mt-3 text-sm text-muted-foreground">
              <summary className="cursor-pointer">{skipped.length} skipped</summary>
              <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                {skipped.map((item) => (
                  <li key={item.id}>
                    {item.title || item.id}: {item.detail}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {busy ? <WaitingNote label="Applying the selected changes" /> : null}
          {outcome !== null ? (
            <ul className="mt-3 flex flex-col gap-0.5 text-sm" aria-live="polite">
              {outcome.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          {phase.kind === "ready" && phase.preview.canUndo ? (
            <Button
              variant="ghost"
              className="sm:mr-auto"
              disabled={busy}
              onClick={() => void session.undo()}
            >
              Undo last sync
            </Button>
          ) : null}
          <Button variant="outline" onClick={session.close}>
            Close
          </Button>
          <Button disabled={busy || ready.length === 0} onClick={() => void session.apply()}>
            {ready.length > 0 ? `Apply ${ready.length}` : "Apply"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function SyncRow({
  item,
  checked,
  side,
  onCheckedChange,
  onSideChange,
}: {
  readonly item: ClaudeDesktopSyncItem;
  readonly checked: boolean;
  readonly side: Side | undefined;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly onSideChange: (side: Side) => void;
}) {
  return (
    <li className="flex items-start gap-2 rounded-md px-1 py-1.5">
      <Checkbox
        className="mt-0.5"
        aria-label={`${ACTION_LABELS[item.kind]}: ${item.title}`}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title || "Untitled"}</p>
        <p className="truncate text-xs text-muted-foreground">
          {ACTION_LABELS[item.kind]}
          {item.kind === "conflict" ? "" : ` · ${item.detail}`}
        </p>
        {item.kind === "conflict" ? (
          <div className="mt-1 flex flex-wrap gap-1" role="radiogroup" aria-label="Keep which side">
            <SideChoice
              label={`Keep Claude Desktop: ${item.desktopValue ?? ""}`}
              active={side === "desktop"}
              onClick={() => onSideChange("desktop")}
            />
            <SideChoice
              label={`Keep T3: ${item.t3Value ?? ""}`}
              active={side === "t3"}
              onClick={() => onSideChange("t3")}
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function SideChoice({
  label,
  active,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Button
      size="compact"
      variant={active ? "secondary" : "outline"}
      role="radio"
      aria-checked={active}
      className="max-w-full"
      onClick={onClick}
    >
      <span className="truncate">{label}</span>
    </Button>
  );
}

function describeApply(result: ClaudeDesktopSyncApplyResult): ReadonlyArray<string> {
  const lines = [`Applied ${result.applied} in T3.`];
  if (result.queuedForDesktop > 0) {
    lines.push(
      `${result.queuedForDesktop} Claude Desktop ${result.queuedForDesktop === 1 ? "change shows" : "changes show"} after you quit and reopen that app from its Dock icon.`,
    );
  }
  for (const failure of result.failed) lines.push(`Failed ${failure.id}: ${failure.error}`);
  return lines;
}

function WaitingNote({ label }: { readonly label: string }) {
  const [startedAt] = useState(() => performance.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setSeconds(Math.floor((performance.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [startedAt]);
  return (
    <p className="mt-3 text-sm text-muted-foreground first:mt-0" role="status">
      {label}…{seconds >= 2 ? ` ${seconds} s` : ""}
    </p>
  );
}
