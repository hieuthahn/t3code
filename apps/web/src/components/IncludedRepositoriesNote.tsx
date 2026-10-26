import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { cn } from "~/lib/utils";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { useT3ProjectFileState } from "../hooks/useT3ProjectFileScripts";
import { useNestedRepositories } from "../state/queries";
import { serverEnvironment } from "../state/server";
import {
  formatIncludedRepositoriesLabel,
  resolveIncludedNestedRepositoryCount,
} from "./BranchToolbar.logic";

/** Names how many inner repositories a new worktree will include; renders nothing at zero. */
export function IncludedRepositoriesNote(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly visible: boolean;
  readonly displayMode?: "toolbar" | "panel";
}) {
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(props.environmentId));
  const setting = serverConfig
    ? resolveProjectSettings(serverConfig.settings, props.projectId).settings
        .worktreeNestedRepositories
    : null;
  const repositories = useNestedRepositories(
    props.visible ? { environmentId: props.environmentId, projectId: props.projectId } : null,
  ).data?.repositories;
  const projectFile = useT3ProjectFileState(
    props.environmentId,
    props.visible && setting === null ? props.workspaceRoot : null,
  ).file;
  if (!props.visible || repositories === undefined) return null;
  const count = resolveIncludedNestedRepositoryCount({
    setting,
    projectFileSetting: projectFile?.worktreeNestedRepositories,
    discoveredPaths: repositories.map((repository) => repository.path),
  });
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 shrink-0 items-center font-normal text-muted-foreground/70 text-xs",
        props.displayMode === "panel" ? "h-5 pl-7.75" : "h-7 px-1.75 sm:h-6",
      )}
      data-composer-context-control
      data-included-repositories={count}
    >
      {formatIncludedRepositoriesLabel(count)}
    </span>
  );
}
