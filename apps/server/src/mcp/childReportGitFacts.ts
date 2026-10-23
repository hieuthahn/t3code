import type { GitCommandError, OrchestrationV2ChildReportGitFacts } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

export type ChildReportGitExecute = (input: {
  readonly operation: string;
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly allowNonZeroExit: true;
}) => Effect.Effect<{ readonly exitCode: number; readonly stdout: string }, GitCommandError>;

const DEFAULT_MAX_FILES = 50;

/**
 * Reads what the child's checkout shows about its work, compared with the parent's base.
 * Returns null when the checkout is not a git repository or git cannot run.
 */
export const readChildReportGitFacts = Effect.fn("ChildReport.readGitFacts")(
  function* (
    execute: ChildReportGitExecute,
    input: { readonly cwd: string; readonly baseRef: string | null; readonly maxFiles?: number },
  ): Effect.fn.Return<OrchestrationV2ChildReportGitFacts | null, GitCommandError> {
    const git = (...args: ReadonlyArray<string>) =>
      execute({
        operation: "childReport.gitFacts",
        cwd: input.cwd,
        args,
        allowNonZeroExit: true,
      }).pipe(Effect.map((result) => (result.exitCode === 0 ? result.stdout.trim() : null)));

    if ((yield* git("rev-parse", "--is-inside-work-tree")) !== "true") return null;
    const branchName = yield* git("rev-parse", "--abbrev-ref", "HEAD");
    const headSha = yield* git("rev-parse", "HEAD");
    const baseSha =
      input.baseRef === null || headSha === null
        ? null
        : yield* git("merge-base", "HEAD", input.baseRef);
    const distance =
      baseSha === null
        ? null
        : yield* git("rev-list", "--left-right", "--count", `${baseSha}...HEAD`);
    const [behindBy, aheadBy] = parseLeftRightCount(distance);
    const dirty = ((yield* git("status", "--porcelain")) ?? "") !== "";
    const files =
      baseSha === null
        ? { filesChanged: [], filesTruncated: false }
        : parseChangedFiles(
            (yield* git("diff", "--no-renames", "--name-status", baseSha)) ?? "",
            (yield* git("diff", "--no-renames", "--numstat", baseSha)) ?? "",
            input.maxFiles ?? DEFAULT_MAX_FILES,
          );
    return {
      branch: branchName === null || branchName === "HEAD" ? null : branchName,
      headSha,
      baseRef: input.baseRef,
      baseSha,
      aheadBy,
      behindBy,
      dirty,
      ...files,
    };
  },
  Effect.orElseSucceed(() => null),
);

function parseLeftRightCount(stdout: string | null): readonly [number | null, number | null] {
  const counts = stdout?.split(/\s+/).map(Number) ?? [];
  return counts.length === 2 && counts.every(Number.isSafeInteger)
    ? [counts[0] ?? null, counts[1] ?? null]
    : [null, null];
}

function parseChangedFiles(
  nameStatus: string,
  numstat: string,
  maxFiles: number,
): Pick<OrchestrationV2ChildReportGitFacts, "filesChanged" | "filesTruncated"> {
  const lineCounts = new Map(
    numstat
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [additions = "-", deletions = "-", ...path] = line.split("\t");
        return [
          path.join("\t"),
          { additions: countOrNull(additions), deletions: countOrNull(deletions) },
        ];
      }),
  );
  const entries = nameStatus
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [status = "", ...path] = line.split("\t");
      const filePath = path.join("\t");
      return {
        path: filePath,
        status,
        ...(lineCounts.get(filePath) ?? { additions: null, deletions: null }),
      };
    });
  return { filesChanged: entries.slice(0, maxFiles), filesTruncated: entries.length > maxFiles };
}

function countOrNull(value: string): number | null {
  const count = Number(value);
  return value !== "" && Number.isSafeInteger(count) && count >= 0 ? count : null;
}
