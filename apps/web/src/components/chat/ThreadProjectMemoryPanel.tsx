import { useAtomValue } from "@effect/atom-react";
import { Maximize2Icon, PencilIcon, XIcon } from "lucide-react";
import { useState } from "react";
import {
  AuthOrchestrationOperateScope,
  PROJECT_MEMORY_MAX_TEXT_CHARS,
  type EnvironmentId,
  type ProjectId,
  type ProjectMemoryEntry,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { Input } from "../ui/input";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { ThreadProjectMemoryDialog } from "./ThreadProjectMemoryDialog";
import { THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS } from "./threadDetailsPanelStyles";

const ROW_ACTIONS_CLASS =
  "flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100";

/** The project's shared memory, newest first, for every thread of the project. */
export function ThreadProjectMemoryPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
}) {
  const { environmentId, projectId } = props;
  const canOperate = useAtomValue(
    serverEnvironment.appendProjectMemory.permissionAtom(environmentId),
  );
  const memoryQuery = useEnvironmentQuery(
    projectId === null
      ? null
      : serverEnvironment.projectMemoryLive({ environmentId, input: { projectId } }),
  );
  const appendEntry = useAtomCommand(serverEnvironment.appendProjectMemory, {
    label: "project memory append",
  });
  const editEntry = useAtomCommand(serverEnvironment.editProjectMemory, {
    label: "project memory edit",
  });
  const deleteEntry = useAtomCommand(serverEnvironment.deleteProjectMemory, {
    label: "project memory delete",
  });
  const [newText, setNewText] = useState("");
  const [dialog, setDialog] = useState<{
    readonly entryId: string | null;
    readonly text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  if (projectId === null) return null;
  const entries: ReadonlyArray<ProjectMemoryEntry> = memoryQuery.data ?? [];
  const loaded = memoryQuery.data !== null;

  const run = async (
    failureTitle: string,
    command: () => ReturnType<typeof appendEntry | typeof editEntry | typeof deleteEntry>,
  ) => {
    if (busy || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      return { saved: false, message: null };
    }
    setBusy(true);
    const result = await command();
    setBusy(false);
    if (result._tag === "Success") return { saved: true, message: null };
    if (isAtomCommandInterrupted(result)) return { saved: false, message: null };
    const error = squashAtomCommandFailure(result);
    const message = error instanceof Error ? error.message : String(error);
    toastManager.add(
      stackedThreadToast({ type: "error", title: failureTitle, description: message }),
    );
    return { saved: false, message };
  };

  const add = async () => {
    const text = newText.trim();
    if (text.length === 0) return;
    const { saved } = await run("Could not save the memory", () =>
      appendEntry({ environmentId, input: { projectId, text } }),
    );
    if (saved) setNewText("");
  };

  const openDialog = (entryId: string | null, text: string) => {
    setDialogError(null);
    setDialog({ entryId, text });
  };

  const saveDialog = async (text: string) => {
    if (dialog === null) return;
    const trimmed = text.trim();
    const { saved, message } = await run("Could not save the memory", () =>
      dialog.entryId === null
        ? appendEntry({ environmentId, input: { projectId, text: trimmed } })
        : editEntry({
            environmentId,
            input: { projectId, entryId: dialog.entryId, text: trimmed },
          }),
    );
    if (!saved) {
      setDialogError(message === null ? null : `Could not save: ${message}`);
      return;
    }
    if (dialog.entryId === null) setNewText("");
    setDialog(null);
  };

  const deleteFromDialog = async () => {
    const entryId = dialog?.entryId;
    if (entryId === null || entryId === undefined) return;
    const { saved, message } = await run("Could not delete the memory", () =>
      deleteEntry({ environmentId, input: { projectId, entryId } }),
    );
    if (saved) setDialog(null);
    else setDialogError(message === null ? null : `Could not delete: ${message}`);
  };

  return (
    <ThreadDetailsSection
      headingId="thread-details-project-memory-heading"
      title="Memory"
      data-thread-project-memory-panel
    >
      {memoryQuery.error !== null ? (
        <p className="px-2.5 py-1.5 text-2xs text-destructive">
          Could not load the memory: {memoryQuery.error}
        </p>
      ) : null}

      <div className="flex items-center gap-1 px-1.5 pb-1">
        <Input
          size="compact"
          aria-label="Add to memory"
          placeholder="Add to memory"
          maxLength={PROJECT_MEMORY_MAX_TEXT_CHARS}
          value={newText}
          disabled={!canOperate}
          onValueChange={setNewText}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) void add();
          }}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                size="icon-xs"
                variant="ghost"
                part="icon"
                aria-label="Write a longer memory"
                disabled={!canOperate || busy}
                onClick={() => openDialog(null, newText)}
              >
                <Maximize2Icon className="size-3.5" />
              </ThreadDetailsControl>
            }
          />
          <TooltipPopup>Open editor</TooltipPopup>
        </Tooltip>
      </div>

      {loaded && entries.length === 0 && memoryQuery.error === null ? (
        <p className="px-2.5 py-1.5 text-2xs text-muted-foreground">Nothing saved yet.</p>
      ) : null}

      <ul className="m-0 list-none p-0">
        {entries.map((entry) => (
          <li key={entry.id} data-memory-entry-id={entry.id} className="rounded-lg py-1">
            <div className={cn("group flex items-start", THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS)}>
              <button
                type="button"
                data-memory-entry-open
                aria-haspopup="dialog"
                className="min-w-0 flex-1 cursor-pointer rounded-md py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => openDialog(entry.id, entry.text)}
              >
                <span
                  data-memory-entry-text
                  className="line-clamp-2 whitespace-pre-wrap break-words text-sm text-foreground/80"
                >
                  {entry.text}
                </span>
              </button>
              <div className={ROW_ACTIONS_CLASS}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <ThreadDetailsControl
                        size="icon-xs"
                        variant="ghost"
                        part="icon"
                        aria-label={`Edit memory: ${entry.text}`}
                        disabled={!canOperate || busy}
                        onClick={() => openDialog(entry.id, entry.text)}
                      >
                        <PencilIcon className="size-3.5" />
                      </ThreadDetailsControl>
                    }
                  />
                  <TooltipPopup>Edit</TooltipPopup>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <ThreadDetailsControl
                        size="icon-xs"
                        variant="ghost"
                        part="icon"
                        aria-label={`Delete memory: ${entry.text}`}
                        disabled={!canOperate || busy}
                        onClick={() =>
                          void run("Could not delete the memory", () =>
                            deleteEntry({
                              environmentId,
                              input: { projectId, entryId: entry.id },
                            }),
                          )
                        }
                      >
                        <XIcon className="size-3.5" />
                      </ThreadDetailsControl>
                    }
                  />
                  <TooltipPopup>Delete</TooltipPopup>
                </Tooltip>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {dialog !== null ? (
        <ThreadProjectMemoryDialog
          key={dialog.entryId ?? "new"}
          initialText={dialog.text}
          isNew={dialog.entryId === null}
          canOperate={canOperate}
          busy={busy}
          error={dialogError}
          onSave={(text) => void saveDialog(text)}
          onDelete={dialog.entryId === null ? null : () => void deleteFromDialog()}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </ThreadDetailsSection>
  );
}
