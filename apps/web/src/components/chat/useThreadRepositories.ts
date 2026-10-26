import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { fileBasename } from "@t3tools/shared/path";

import { useRepositorySelectionStore } from "../../repositorySelectionStore";
import { useEnvironmentQuery } from "../../state/query";
import { useNestedRepositories, useThreadRepositoryTags } from "../../state/queries";
import { vcsEnvironment } from "../../state/vcs";
import {
  buildRepositoryOptions,
  resolveSelectedRepositoryPath,
  type RepositoryOption,
} from "./repositorySelection";

const NO_REPOSITORIES: readonly never[] = [];

export interface ThreadRepositories {
  /** Empty unless the project has nested repositories and the thread runs in the project checkout. */
  readonly options: readonly RepositoryOption[];
  readonly selected: RepositoryOption | null;
  /** The nested repository's absolute path, or null for the outer repository. */
  readonly repositoryCwd: string | null;
  readonly select: (path: string | null) => void;
}

/** Resolve which repository the thread's git section targets; inert for worktree threads. */
export function useThreadRepositories(
  target: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
    readonly projectName: string;
    readonly workspaceRoot: string;
    readonly worktreePath: string | null;
  } | null,
): ThreadRepositories {
  const queryTarget = target === null || target.worktreePath !== null ? null : target;
  const repositories = useNestedRepositories(queryTarget).data?.repositories ?? NO_REPOSITORIES;
  const tags = useThreadRepositoryTags(queryTarget).data?.threads;
  const outerStatus = useEnvironmentQuery(
    queryTarget === null || repositories.length === 0
      ? null
      : vcsEnvironment.status({
          environmentId: queryTarget.environmentId,
          input: { cwd: queryTarget.workspaceRoot },
        }),
  );
  const threadKey =
    target === null ? null : scopedThreadKey(scopeThreadRef(target.environmentId, target.threadId));
  const stored = useRepositorySelectionStore((state) =>
    threadKey === null ? undefined : state.byThreadKey[threadKey],
  );
  const selectStored = useRepositorySelectionStore((state) => state.select);
  const outerBranch = outerStatus.data?.refName ?? null;

  const options =
    queryTarget === null || repositories.length === 0
      ? NO_REPOSITORIES
      : buildRepositoryOptions({
          workspaceRoot: queryTarget.workspaceRoot,
          projectName: queryTarget.projectName,
          projectFolder: fileBasename(queryTarget.workspaceRoot),
          outerBranch,
          repositories,
        });
  const selectedPath = resolveSelectedRepositoryPath({
    repositories,
    stored,
    tagged: target === null ? undefined : tags?.[target.threadId],
  });
  const selected = options.find((option) => option.path === selectedPath) ?? null;
  const threadId = target?.threadId;
  const environmentId = target?.environmentId;
  const select = (path: string | null) => {
    if (threadId === undefined || environmentId === undefined) return;
    selectStored(scopeThreadRef(environmentId, threadId), path);
  };

  return {
    options,
    selected,
    repositoryCwd: selected !== null && selected.path !== null ? selected.cwd : null,
    select,
  };
}
