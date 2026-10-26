import { GitCommandError, GitManagerError, VcsRepositoryDetectionError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as KnownWorkspaces from "./KnownWorkspaces.ts";

type KnownWorkspacesService = KnownWorkspaces.KnownWorkspaces["Service"];

/** Rejects a git or vcs cwd outside every known workspace, which includes nested repos under one. */
export const makeGitCwdGuard = (knownWorkspaces: KnownWorkspacesService) => ({
  asGitCommandError: (operation: string, cwd: string) =>
    knownWorkspaces
      .assertContains(cwd)
      .pipe(
        Effect.mapError(
          (error) => new GitCommandError({ operation, command: "git", cwd, detail: error.message }),
        ),
      ),
  asGitManagerError: (operation: string, cwd: string) =>
    knownWorkspaces
      .assertContains(cwd)
      .pipe(
        Effect.mapError((error) => new GitManagerError({ operation, cwd, detail: error.message })),
      ),
  asVcsError: (operation: string, cwd: string) =>
    knownWorkspaces
      .assertContains(cwd)
      .pipe(
        Effect.mapError(
          (error) => new VcsRepositoryDetectionError({ operation, cwd, detail: error.message }),
        ),
      ),
});
