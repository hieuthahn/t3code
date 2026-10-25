import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { formatSubagentDisplayTitle } from "@t3tools/client-runtime/state/subagent-display";
import { ChevronRightIcon } from "lucide-react";
import { use } from "react";

import { useThreadShell } from "../../state/entities";
import { TimelineRowCtx, type TimelineRow } from "./timelineRowContext";

export function ChildMessageTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "child-message" }>;
}) {
  const ctx = use(TimelineRowCtx);
  const shell = useThreadShell(scopeThreadRef(ctx.activeThreadEnvironmentId, row.childThreadId));
  const title = shell === null ? "a thread" : formatSubagentDisplayTitle(shell.title);
  return (
    <button
      type="button"
      className="group/child-message flex min-h-6 max-w-full items-center gap-1.5 rounded-md px-1 text-left text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`Messaged ${title}. Open thread`}
      onClick={() => ctx.onOpenThread(row.childThreadId)}
    >
      <span className="shrink-0">Messaged</span>
      <span className="min-w-0 truncate font-medium text-foreground">{title}</span>
      <ChevronRightIcon
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover/child-message:text-foreground"
      />
    </button>
  );
}
