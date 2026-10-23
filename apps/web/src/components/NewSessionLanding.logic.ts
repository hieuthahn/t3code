import type {
  EnvironmentId,
  ProjectId,
  SavedEnvironment,
  ScopedProjectRef,
} from "@t3tools/contracts";

export type SavedEnvironmentLaunch =
  | { readonly kind: "scratch"; readonly environmentId: EnvironmentId }
  | {
      readonly kind: "project";
      readonly projectRef: ScopedProjectRef;
      readonly envMode: "worktree" | undefined;
    }
  | { readonly kind: "unavailable" };

export function resolveSavedEnvironmentLaunch(
  saved: SavedEnvironment,
  projects: readonly { readonly environmentId: EnvironmentId; readonly id: ProjectId }[],
): SavedEnvironmentLaunch {
  if (saved.folder === null) {
    return { kind: "scratch", environmentId: saved.environmentId };
  }
  const exists = projects.some(
    (project) => project.environmentId === saved.environmentId && project.id === saved.folder,
  );
  if (!exists) return { kind: "unavailable" };
  return {
    kind: "project",
    projectRef: { environmentId: saved.environmentId, projectId: saved.folder },
    envMode: saved.worktree ? "worktree" : undefined,
  };
}
