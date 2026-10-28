import { useState } from "react";
import { PROJECT_MEMORY_MAX_TEXT_CHARS } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";

/** Write or read one memory in full, with the length it may reach and the actions it allows. */
export function ThreadProjectMemoryDialog(props: {
  readonly initialText: string;
  readonly isNew: boolean;
  readonly canOperate: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSave: (text: string) => void;
  readonly onDelete: (() => void) | null;
  readonly onClose: () => void;
}) {
  const [draft, setDraft] = useState(props.initialText);
  const length = draft.trim().length;
  const overLimit = length > PROJECT_MEMORY_MAX_TEXT_CHARS;
  const changed = props.isNew || draft.trim() !== props.initialText.trim();
  const canSave = props.canOperate && !props.busy && length > 0 && !overLimit && changed;
  const save = () => {
    if (canSave) props.onSave(draft);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose();
      }}
    >
      <DialogPopup className="max-w-md" data-thread-project-memory-dialog>
        <DialogHeader>
          <DialogTitle>{props.isNew ? "New memory" : "Memory"}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="grid gap-1.5">
            <Textarea
              aria-label="Memory text"
              autoFocus
              size="lg"
              className="[&_textarea]:min-h-32"
              value={draft}
              readOnly={!props.canOperate}
              disabled={props.busy}
              aria-invalid={overLimit || undefined}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey) &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  save();
                }
              }}
            />
            <p
              aria-live="polite"
              data-memory-counter
              className={cn(
                "text-end text-2xs tabular-nums",
                overLimit ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {length}/{PROJECT_MEMORY_MAX_TEXT_CHARS}
            </p>
            {props.error !== null ? (
              <p role="alert" className="text-xs text-destructive">
                Could not save: {props.error}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          {props.onDelete !== null ? (
            <Button
              variant="destructive-outline"
              className="sm:me-auto"
              disabled={!props.canOperate || props.busy}
              onClick={props.onDelete}
            >
              Delete
            </Button>
          ) : null}
          <Button variant="outline" disabled={props.busy} onClick={props.onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
