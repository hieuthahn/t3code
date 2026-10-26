import { useEffect } from "react";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { fileBasename } from "@t3tools/shared/path";

import { useRepositorySelectionStore } from "../../repositorySelectionStore";
import { useEnvironmentQuery } from "../../state/query";
import { useNestedRepositories, useThreadRepositoryTags } from "../../state/queries";
import { vcsEnvironment } from "../../state/vcs";
import {
  buildRepositoryOptions,
  isStaleRepositorySelection,
  resolveSelectedRepositoryPath,
  type RepositoryOption,
} from "./repositorySelection";

const NO_REPOSITORIES: readonly never[] = [];

export interface ThreadRepositories {
  /** Empty unless the project has nested repositories, or the thread worktree holds inner worktrees. */
  readonly options: readonly RepositoryOption[];
  readonly selected: RepositoryOption | null;
  /** The nested repository's absolute path, or null for the outer repository. */
  readonly repositoryCwd: string | null;
  readonly select: (path: string | null) => void;
}

/** Resolve which repository the thread's git section targets, under the worktree when the thread has one. */
export function useThreadRepositories(
  target: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
    readonly projectName: string;
    readonly workspaceRoot: string;
    readonly worktreePath: string | null;
    /** A worktree-mode thread without a worktree yet still runs in the project root. */
    readonly envMode?: "local" | "worktree";
  } | null,
): ThreadRepositories {
  const queryTarget =
    target === null || (target.worktreePath === null && target.envMode === "worktree")
      ? null
      : target;
  const repositoriesData = useNestedRepositories(
    queryTarget === null
      ? null
      : {
          environmentId: queryTarget.environmentId,
          projectId: queryTarget.projectId,
          ...(queryTarget.worktreePath === null ? {} : { threadId: queryTarget.threadId }),
        },
  ).data;
  const repositories = repositoriesData?.repositories ?? NO_REPOSITORIES;
  const tagsData = useThreadRepositoryTags(queryTarget).data;
  const tags = tagsData?.threads;
  const outerStatus = useEnvironmentQuery(
    queryTarget === null || repositories.length === 0
      ? null
      : vcsEnvironment.status({
          environmentId: queryTarget.environmentId,
          input: { cwd: queryTarget.worktreePath ?? queryTarget.workspaceRoot },
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
          workspaceRoot: queryTarget.worktreePath ?? queryTarget.workspaceRoot,
          projectName: queryTarget.projectName,
          projectFolder: fileBasename(queryTarget.workspaceRoot),
          outerBranch,
          repositories,
        });
  const selectedPath = resolveSelectedRepositoryPath({
    repositories,
    stored,
    tagged: target === null ? undefined : tags?.[target.threadId],
    touchCounts: target === null ? undefined : tagsData?.touchCounts?.[target.threadId],
  });
  const removeStored = useRepositorySelectionStore((state) => state.removeThread);
  const threadIdForCleanup = target?.threadId;
  const environmentIdForCleanup = target?.environmentId;
  const isStale =
    repositoriesData !== undefined && isStaleRepositorySelection({ repositories, stored });
  useEffect(() => {
    if (!isStale || threadIdForCleanup === undefined || environmentIdForCleanup === undefined) {
      return;
    }
    removeStored(scopeThreadRef(environmentIdForCleanup, threadIdForCleanup));
  }, [isStale, threadIdForCleanup, environmentIdForCleanup, removeStored]);
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
