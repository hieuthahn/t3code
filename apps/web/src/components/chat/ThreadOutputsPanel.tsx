import { FileIcon } from "lucide-react";
import { useState } from "react";
import { fileBasename, isAbsolutePath, workspaceRelativeFilePath } from "@t3tools/shared/path";

import type { ThreadOutput, ThreadOutputStatus } from "../../lib/threadOutputs";
import { cn } from "../../lib/utils";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

const VISIBLE_OUTPUT_LIMIT = 5;

const STATUS_LABEL: Record<ThreadOutputStatus, string> = {
  created: "Created",
  edited: "Edited",
  deleted: "Deleted",
};

function workspacePath(path: string, workspaceRoot: string | null): string | null {
  return isAbsolutePath(path) ? workspaceRelativeFilePath(path, workspaceRoot) : path;
}

/** Files the thread created or edited, each opening in the file panel. Renders nothing when empty. */
export function ThreadOutputsPanel(props: {
  readonly outputs: ReadonlyArray<ThreadOutput>;
  readonly workspaceRoot: string | null;
  readonly onOpenFile: (relativePath: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (props.outputs.length === 0) return null;
  const visible = expanded ? props.outputs : props.outputs.slice(0, VISIBLE_OUTPUT_LIMIT);
  const hiddenCount = props.outputs.length - visible.length;
  return (
    <ThreadDetailsSection
      headingId="thread-details-outputs-heading"
      title="Outputs"
      data-thread-outputs-panel
    >
      <ul className="m-0 flex list-none flex-col p-0">
        {visible.map((output) => {
          const relativePath = output.status === "deleted" ? null : workspacePath(output.path, props.workspaceRoot);
          const content = (
            <>
              <FileIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
              <span className="min-w-0 flex-1 text-left">
                <span
                  className={cn(
                    "block truncate text-sm",
                    output.status === "deleted" && "line-through opacity-70",
                    THREAD_DETAILS_PANEL_LABEL_CLASS,
                  )}
                >
                  {fileBasename(output.path)}
                </span>
                <span className="block truncate text-2xs font-normal text-muted-foreground">
                  {STATUS_LABEL[output.status]}
                  {relativePath === null ? "" : ` · ${relativePath}`}
                </span>
              </span>
            </>
          );
          return (
            <li key={output.path}>
              {relativePath === null ? (
                <div className="flex min-h-8 items-center gap-2.5 px-2.5 py-0.75 text-foreground/80">
                  {content}
                </div>
              ) : (
                <ThreadDetailsControl
                  multiline
                  title={output.path}
                  onClick={() => props.onOpenFile(relativePath)}
                >
                  {content}
                </ThreadDetailsControl>
              )}
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 || expanded ? (
        <ThreadDetailsControl part="meta" className="ml-2.5 mt-1" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer" : `Show ${hiddenCount} more`}
        </ThreadDetailsControl>
      ) : null}
    </ThreadDetailsSection>
  );
}
