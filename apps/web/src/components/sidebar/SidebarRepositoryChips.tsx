import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { fileBasename } from "@t3tools/shared/path";

import { useThreadRepositoryTags } from "../../state/queries";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { summarizeRepositoryChips } from "./repositoryChips";

const CHIP_CLASS_NAME =
  "inline-flex h-4 max-w-16 shrink-0 items-center truncate rounded-sm bg-sidebar-foreground/8 px-1 text-2xs font-medium text-secondary-label";

/** Name the nested repositories a thread touched; renders nothing for a project without any. */
export function SidebarRepositoryChips(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly workspaceRoot: string | null;
}) {
  const tags = useThreadRepositoryTags(props);
  const repositories = tags.data?.threads[props.threadId];
  const summary = summarizeRepositoryChips(
    repositories,
    props.workspaceRoot === null ? null : fileBasename(props.workspaceRoot),
  );
  if (summary === null || repositories === undefined) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-testid="sidebar-repository-chips"
            className="flex shrink-0 items-center gap-1"
          />
        }
      >
        {summary.labels.map((label) => (
          <span key={label} className={CHIP_CLASS_NAME}>
            {label}
          </span>
        ))}
        {summary.overflow > 0 ? <span className={CHIP_CLASS_NAME}>+{summary.overflow}</span> : null}
      </TooltipTrigger>
      <TooltipPopup side="right">{repositories.join(", ")}</TooltipPopup>
    </Tooltip>
  );
}
