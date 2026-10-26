import type { OrchestrationNestedRepository } from "@t3tools/contracts";

import { repositoryShortName } from "../sidebar/repositoryChips";

export interface RepositoryOption {
  /** Null for the outer repository, otherwise the path relative to the workspace root. */
  readonly path: string | null;
  readonly label: string;
  readonly branch: string | null;
  readonly cwd: string;
}

/** Join a workspace root and a forward-slash relative path using the root's own separator. */
export function joinWorkspacePath(workspaceRoot: string, relativePath: string): string {
  const separator = workspaceRoot.includes("\\") && !workspaceRoot.includes("/") ? "\\" : "/";
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  return `${root}${separator}${relativePath.split("/").join(separator)}`;
}

/** List the outer repository first, then each nested repository with its short name. */
export function buildRepositoryOptions(input: {
  readonly workspaceRoot: string;
  readonly projectName: string;
  readonly projectFolder: string;
  readonly outerBranch: string | null;
  readonly repositories: readonly OrchestrationNestedRepository[];
}): readonly RepositoryOption[] {
  return [
    {
      path: null,
      label: input.projectName,
      branch: input.outerBranch,
      cwd: input.workspaceRoot,
    },
    ...input.repositories.map((repository) => ({
      path: repository.path,
      label: repositoryShortName(repository.path, input.projectFolder),
      branch: repository.branch,
      cwd: joinWorkspacePath(input.workspaceRoot, repository.path),
    })),
  ];
}

/**
 * Pick the repository for a thread: a stored choice that still exists wins (null is an explicit outer choice),
 * then the first repository the thread touched, then the outer repository.
 */
export function resolveSelectedRepositoryPath(input: {
  readonly repositories: readonly OrchestrationNestedRepository[];
  readonly stored: string | null | undefined;
  readonly tagged: readonly string[] | undefined;
}): string | null {
  const known = new Set(input.repositories.map((repository) => repository.path));
  if (input.stored === null) return null;
  if (input.stored !== undefined && known.has(input.stored)) return input.stored;
  return input.tagged?.find((path) => known.has(path)) ?? null;
}
