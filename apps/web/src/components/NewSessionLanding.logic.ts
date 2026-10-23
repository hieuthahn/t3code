import type {
  EnvironmentId,
  ProjectId,
  SavedEnvironment,
  ScopedProjectRef,
} from "@t3tools/contracts";

export type SavedEnvironmentLaunch =
  | { readonly kind: "scratch"; readonly environmentId: EnvironmentId }
  | {
      readonly kind: "folders";
      readonly projectRefs: readonly ScopedProjectRef[];
      readonly envMode: "worktree" | undefined;
      readonly missingFolderCount: number;
    }
  | { readonly kind: "unavailable" };

/** T3 threads have one workspace, so a saved setup with several folders opens one draft each. */
export function resolveSavedEnvironmentLaunch(
  saved: SavedEnvironment,
  projects: readonly { readonly environmentId: EnvironmentId; readonly id: ProjectId }[],
): SavedEnvironmentLaunch {
  if (saved.folders.length === 0) {
    return { kind: "scratch", environmentId: saved.environmentId };
  }
  const projectRefs = saved.folders
    .filter((folder) =>
      projects.some(
        (project) => project.environmentId === saved.environmentId && project.id === folder,
      ),
    )
    .map((projectId) => ({ environmentId: saved.environmentId, projectId }));
  if (projectRefs.length === 0) return { kind: "unavailable" };
  return {
    kind: "folders",
    projectRefs,
    envMode: saved.worktreePerFolder ? "worktree" : undefined,
    missingFolderCount: saved.folders.length - projectRefs.length,
  };
}
