import type { EnvironmentId, MergeQueueDiffFile, MergeQueueItemId } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";

const countText = (file: MergeQueueDiffFile) =>
  file.additions === null || file.deletions === null
    ? "binary"
    : `+${file.additions} −${file.deletions}`;

const lineKind = (line: string) => {
  if (line.startsWith("+++") || line.startsWith("---")) return "file";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "delete";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("diff ")) return "file";
  return "context";
};

const LINE_CLASS: Record<ReturnType<typeof lineKind>, string> = {
  add: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  delete: "bg-destructive/10 text-destructive",
  hunk: "text-sky-700 dark:text-sky-300",
  file: "font-semibold text-foreground/80",
  context: "text-muted-foreground",
};

/** The child's changes at the commit awaiting approval, since the gates run that code on this host. */
export function MergeQueueItemDiff(props: {
  readonly environmentId: EnvironmentId;
  readonly itemId: MergeQueueItemId;
  readonly headSha: string;
}) {
  const diffQuery = useEnvironmentQuery(
    serverEnvironment.mergeQueueDiff({
      environmentId: props.environmentId,
      input: { itemId: props.itemId, headSha: props.headSha },
    }),
  );
  const diff = diffQuery.data;

  if (diffQuery.error !== null) {
    return (
      <p className="py-1 text-2xs text-destructive break-words">
        Could not load the changes: {diffQuery.error}
      </p>
    );
  }
  if (diff === null) {
    return <p className="py-1 text-2xs text-muted-foreground">Loading the changes…</p>;
  }
  const additions = diff.files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const deletions = diff.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);

  return (
    <Collapsible>
      <CollapsibleTrigger
        aria-label="Review the changes"
        className="group flex items-center gap-1 py-1 text-2xs font-medium text-muted-foreground"
      >
        <ChevronRightIcon className="size-3 transition-transform group-data-panel-open:rotate-90" />
        {diff.files.length} {diff.files.length === 1 ? "file" : "files"} · +{additions} −{deletions}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ul className="m-0 list-none p-0 pb-1">
          {diff.files.map((file) => (
            <li key={file.path} className="flex items-center gap-2 text-2xs">
              <span className="min-w-0 flex-1 truncate font-mono text-foreground/80">
                {file.path}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{countText(file)}</span>
            </li>
          ))}
        </ul>
        <pre className="m-0 max-h-72 overflow-auto rounded-md border border-border/65 bg-muted/30 py-1 font-mono text-2xs leading-4">
          {diff.patch.split("\n").map((line, index) => {
            const kind = lineKind(line);
            return (
              <div
                // A patch line has no identity beyond its position.
                // oxlint-disable-next-line react/no-array-index-key
                key={index}
                data-diff-line={kind}
                className={cn("px-2 whitespace-pre", LINE_CLASS[kind])}
              >
                {line}
              </div>
            );
          })}
        </pre>
        {diff.truncated ? (
          <p role="status" className="pt-1 text-2xs text-warning-foreground">
            The patch is cut short. Read the rest in the child's worktree before approving.
          </p>
        ) : null}
      </CollapsiblePanel>
    </Collapsible>
  );
}
