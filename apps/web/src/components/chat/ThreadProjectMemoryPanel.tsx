import { useAtomValue } from "@effect/atom-react";
import { PencilIcon, XIcon } from "lucide-react";
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
  const [editing, setEditing] = useState<{ readonly id: string; readonly text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  if (projectId === null) return null;
  const entries: ReadonlyArray<ProjectMemoryEntry> = memoryQuery.data ?? [];

  const run = async (
    failureTitle: string,
    command: () => ReturnType<typeof appendEntry | typeof editEntry | typeof deleteEntry>,
  ) => {
    if (busy || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return false;
    setBusy(true);
    const result = await command();
    setBusy(false);
    if (result._tag === "Success") return true;
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: failureTitle,
          description: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return false;
  };

  const add = async () => {
    const text = newText.trim();
    if (text.length === 0) return;
    const saved = await run("Could not save the memory", () =>
      appendEntry({ environmentId, input: { projectId, text } }),
    );
    if (saved) setNewText("");
  };

  const saveEdit = async (entry: ProjectMemoryEntry, text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed === entry.text) {
      setEditing(null);
      return;
    }
    const saved = await run("Could not save the memory", () =>
      editEntry({ environmentId, input: { projectId, entryId: entry.id, text: trimmed } }),
    );
    if (saved) setEditing(null);
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

      <div className="px-1.5 pb-1">
        <Input
          size="compact"
          aria-label="Add to memory"
          placeholder="Add to memory"
          maxLength={PROJECT_MEMORY_MAX_TEXT_CHARS}
          value={newText}
          disabled={!canOperate}
          onValueChange={setNewText}
          onKeyDown={(event) => {
            if (event.key === "Enter") void add();
          }}
        />
      </div>

      {entries.length === 0 && memoryQuery.error === null ? (
        <p className="px-2.5 py-1.5 text-2xs text-muted-foreground">Nothing saved yet.</p>
      ) : null}

      <ul className="m-0 list-none p-0">
        {entries.map((entry) => (
          <li key={entry.id} data-memory-entry-id={entry.id} className="rounded-lg py-1">
            {editing?.id === entry.id ? (
              <div className="px-1.5">
                <Input
                  size="compact"
                  autoFocus
                  aria-label="Edit memory"
                  maxLength={PROJECT_MEMORY_MAX_TEXT_CHARS}
                  value={editing.text}
                  disabled={busy}
                  onValueChange={(text) => setEditing({ id: entry.id, text })}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveEdit(entry, editing.text);
                    if (event.key === "Escape") setEditing(null);
                  }}
                />
              </div>
            ) : (
              <div className={cn("group flex items-start", THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS)}>
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words py-0.5 text-sm text-foreground/80">
                  {entry.text}
                </p>
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
                          onClick={() => setEditing({ id: entry.id, text: entry.text })}
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
            )}
          </li>
        ))}
      </ul>
    </ThreadDetailsSection>
  );
}
