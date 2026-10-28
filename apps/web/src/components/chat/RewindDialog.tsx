import type { MessageId } from "@t3tools/contracts";
import { useRef } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import type { RewindEntry } from "./rewindDialog.logic";

export function RewindDialog(props: {
  readonly open: boolean;
  readonly entries: ReadonlyArray<RewindEntry>;
  readonly unavailableReason: string | null;
  readonly onSelect: (turnCount: number, messageId: MessageId) => void;
  readonly onClose: () => void;
}) {
  const firstRowRef = useRef<HTMLButtonElement>(null);
  const message =
    props.unavailableReason ?? (props.entries.length === 0 ? "No earlier messages." : null);
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup className="sm:max-w-lg" initialFocus={firstRowRef}>
        <DialogHeader>
          <DialogTitle>Rewind</DialogTitle>
          <DialogDescription>Restore the session to an earlier message.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {message !== null ? (
            <p className="text-muted-foreground text-sm" data-testid="rewind-unavailable">
              {message}
            </p>
          ) : (
            <ul className="-mx-2 flex flex-col gap-0.5" data-testid="rewind-entries">
              {props.entries.map((entry, index) => (
                <li key={entry.messageId}>
                  <button
                    ref={index === 0 ? firstRowRef : undefined}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                    onClick={() => props.onSelect(entry.turnCount, entry.messageId)}
                  >
                    <span className="min-w-0 flex-1 truncate">{entry.preview}</span>
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {formatRelativeTimeLabel(entry.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
