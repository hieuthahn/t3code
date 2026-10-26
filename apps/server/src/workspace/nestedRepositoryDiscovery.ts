import type { OrchestrationNestedRepository } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

const MAX_SCAN_DEPTH = 2;
const SCAN_CONCURRENCY = 16;
const BUILD_OUTPUT_NAMES: ReadonlySet<string> = new Set([
  "dist",
  "build",
  "target",
  "vendor",
  "Pods",
  "DerivedData",
]);

const isScannableName = (name: string, depth: number) =>
  !name.startsWith(".") &&
  name !== "node_modules" &&
  !(depth >= MAX_SCAN_DEPTH && BUILD_OUTPUT_NAMES.has(name));

/**
 * Reads the independent repositories under a workspace root; unreadable entries are skipped.
 * Submodules are left out because the outer repository already owns them.
 */
export const discoverNestedRepositories = Effect.fn("NestedRepositories.discover")(function* (
  workspaceRoot: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const readText = (file: string) => fs.readFileString(file).pipe(Effect.orElseSucceed(() => null));
  const isDirectory = (target: string) =>
    fs.stat(target).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );

  /** Locates the git directory behind a `.git` directory or a `gitdir:` pointer file. */
  const resolveGitDirectory = Effect.fn("NestedRepositories.resolveGitDirectory")(function* (
    repositoryPath: string,
  ) {
    const dotGit = path.join(repositoryPath, ".git");
    if (yield* isDirectory(dotGit)) return dotGit;
    const pointer = (yield* readText(dotGit))?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
    return pointer === undefined ? null : path.resolve(repositoryPath, pointer);
  });

  /** A worktree's config lives in the common directory named by its `commondir` file. */
  const readOriginUrl = Effect.fn("NestedRepositories.readOriginUrl")(function* (
    gitDirectory: string,
  ) {
    const commonPointer = (yield* readText(path.join(gitDirectory, "commondir")))?.trim();
    const commonDirectory =
      commonPointer === undefined ? gitDirectory : path.resolve(gitDirectory, commonPointer);
    const config = yield* readText(path.join(commonDirectory, "config"));
    if (config === null) return null;
    let inOrigin = false;
    for (const line of config.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("[")) inOrigin = /^\[remote\s+"origin"\]$/.test(trimmed);
      else if (inOrigin) {
        const url = trimmed.match(/^url\s*=\s*(.+)$/)?.[1];
        if (url !== undefined) return url.trim();
      }
    }
    return null;
  });

  /** Git keeps a submodule's git directory under the outer repository's own `modules` folder. */
  const outerGitDirectory = yield* resolveGitDirectory(workspaceRoot);
  const modulesDirectory =
    outerGitDirectory === null
      ? null
      : path.join(
          yield* fs.realPath(outerGitDirectory).pipe(Effect.orElseSucceed(() => outerGitDirectory)),
          "modules",
        );
  const isOuterSubmodule = Effect.fn("NestedRepositories.isOuterSubmodule")(function* (
    relativePath: string,
  ) {
    const gitDirectory = yield* resolveGitDirectory(path.join(workspaceRoot, relativePath));
    if (modulesDirectory === null || gitDirectory === null) return false;
    const realGitDirectory = yield* fs
      .realPath(gitDirectory)
      .pipe(Effect.orElseSucceed(() => gitDirectory));
    return realGitDirectory.startsWith(`${modulesDirectory}${path.sep}`);
  });

  const describeRepository = Effect.fn("NestedRepositories.describeRepository")(function* (
    relativePath: string,
  ) {
    const gitDirectory = yield* resolveGitDirectory(path.join(workspaceRoot, relativePath));
    const head = gitDirectory === null ? null : yield* readText(path.join(gitDirectory, "HEAD"));
    return {
      path: relativePath,
      name: relativePath.split("/").at(-1) ?? relativePath,
      branch: head?.match(/^ref:\s*refs\/heads\/(.+?)\s*$/m)?.[1] ?? null,
      originUrl: gitDirectory === null ? null : yield* readOriginUrl(gitDirectory),
    } satisfies OrchestrationNestedRepository;
  });

  type Entry = {
    readonly relativePath: string;
    readonly kind: "repository" | "directory" | "skip";
  };
  const classify = Effect.fn("NestedRepositories.classify")(function* (
    relativeDirectory: string,
    name: string,
    depth: number,
  ) {
    const relativePath = relativeDirectory === "" ? name : `${relativeDirectory}/${name}`;
    if (
      !isScannableName(name, depth) ||
      !(yield* isDirectory(path.join(workspaceRoot, relativePath)))
    ) {
      return { relativePath, kind: "skip" } satisfies Entry;
    }
    const hasGit = yield* fs
      .exists(path.join(workspaceRoot, relativePath, ".git"))
      .pipe(Effect.orElseSucceed(() => false));
    if (!hasGit) return { relativePath, kind: "directory" } satisfies Entry;
    return {
      relativePath,
      kind: (yield* isOuterSubmodule(relativePath)) ? "skip" : "repository",
    } satisfies Entry;
  });

  const walk = Effect.fn("NestedRepositories.walk")(function* (
    relativeDirectory: string,
    depth: number,
  ): Effect.fn.Return<ReadonlyArray<string>> {
    const names = yield* fs
      .readDirectory(path.join(workspaceRoot, relativeDirectory))
      .pipe(Effect.orElseSucceed(() => []));
    const entries = yield* Effect.forEach(
      names.toSorted(),
      (name) => classify(relativeDirectory, name, depth),
      { concurrency: SCAN_CONCURRENCY },
    );
    const nested = yield* Effect.forEach(
      entries.filter((entry) => entry.kind === "directory" && depth < MAX_SCAN_DEPTH),
      (entry) => walk(entry.relativePath, depth + 1),
      { concurrency: SCAN_CONCURRENCY },
    );
    return [
      ...entries.filter((entry) => entry.kind === "repository").map((entry) => entry.relativePath),
      ...nested.flat(),
    ];
  });
  const found = yield* walk("", 1);
  return yield* Effect.forEach(found.toSorted(), describeRepository, {
    concurrency: SCAN_CONCURRENCY,
  });
});
