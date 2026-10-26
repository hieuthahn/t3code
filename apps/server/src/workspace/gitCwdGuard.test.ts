// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ProjectId } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { makeGitCwdGuard } from "./gitCwdGuard.ts";
import * as KnownWorkspaces from "./KnownWorkspaces.ts";

const layer = (projectRoot: string, baseDir: string) =>
  KnownWorkspaces.layer.pipe(
    Layer.provide(SqlitePersistence.layerMemory),
    Layer.provide(
      Layer.mock(ProjectStore.ProjectStoreV2)({
        listShells: () =>
          Effect.succeed([
            {
              id: ProjectId.make("project-0"),
              title: "Project",
              workspaceRoot: projectRoot,
              defaultModelSelection: null,
              scripts: [],
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ]),
      }),
    ),
    Layer.provide(
      Layer.mock(GitVcsDriver.GitVcsDriver)({
        listWorktreePaths: () => Effect.succeed([]),
        execute: (input) =>
          Effect.sync(() => {
            const result = NodeChildProcess.spawnSync("git", [...input.args], {
              cwd: input.cwd,
              encoding: "utf8",
            });
            return {
              exitCode: result.status ?? 1,
              stdout: result.stdout,
              stderr: result.stderr,
              stdoutTruncated: false,
              stderrTruncated: false,
            } as never;
          }),
      }),
    ),
    Layer.provide(ServerSettings.ServerSettingsService.layerTest({})),
    Layer.provide(ServerConfig.layerTest(projectRoot, baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );

it.effect("accepts the project root and a nested repo, and rejects any other path", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const projectRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cwd-guard-project-" });
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cwd-guard-base-" });
    const outside = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cwd-guard-outside-" });
    const nested = `${projectRoot}/backend`;
    yield* fs.makeDirectory(`${nested}/.git`, { recursive: true });
    const sibling = `${projectRoot}-sibling`;
    yield* fs.makeDirectory(sibling);
    yield* Effect.addFinalizer(() => fs.remove(sibling, { recursive: true }).pipe(Effect.ignore));

    yield* Effect.gen(function* () {
      const guard = makeGitCwdGuard(yield* KnownWorkspaces.KnownWorkspaces);

      yield* guard.asGitManagerError("test", projectRoot);
      yield* guard.asGitCommandError("test", nested);
      yield* guard.asVcsError("test", nested);

      const rejected = yield* Effect.forEach([outside, sibling, `${projectRoot}/missing`], (cwd) =>
        Effect.all([
          guard.asGitManagerError("test", cwd).pipe(Effect.flip),
          guard.asGitCommandError("test", cwd).pipe(Effect.flip),
          guard.asVcsError("test", cwd).pipe(Effect.flip),
        ]),
      );
      for (const errors of rejected) {
        assert.deepStrictEqual(
          errors.map((error) => error._tag),
          ["GitManagerError", "GitCommandError", "VcsRepositoryDetectionError"],
        );
      }
      assert.match(
        rejected[0]![0].message,
        /not a registered project, a managed worktree, or a thread's worktree/,
      );
    }).pipe(Effect.provide(layer(projectRoot, baseDir)));
  }).pipe(Effect.provide(NodeServices.layer)),
);

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  NodeChildProcess.spawnSync("git", [...args], { cwd, encoding: "utf8" }).stdout.trim();

it.effect(
  "refuses a write in a nested folder whose .git vanished and leaves the outer repo alone",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const projectRoot = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cwd-guard-outer-" });
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cwd-guard-base-" });
      const nested = `${projectRoot}/backend`;
      const tmpOutside = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cwd-guard-plain-" });
      yield* fs.makeDirectory(nested);
      git(projectRoot, "init", "-q");
      git(projectRoot, "config", "user.email", "t@example.com");
      git(projectRoot, "config", "user.name", "T");
      git(nested, "init", "-q");
      yield* fs.writeFileString(`${nested}/a.txt`, "a");

      yield* Effect.gen(function* () {
        const guard = makeGitCwdGuard(yield* KnownWorkspaces.KnownWorkspaces);
        yield* guard.asGitManagerWrite("test", nested);
        yield* guard.asGitCommandWrite("test", projectRoot);

        yield* fs.remove(`${nested}/.git`, { recursive: true });
        const outerBefore = git(projectRoot, "status", "--porcelain");
        const errors = yield* Effect.all([
          guard.asGitManagerWrite("test", nested).pipe(Effect.flip),
          guard.asGitCommandWrite("test", nested).pipe(Effect.flip),
        ]);
        assert.deepStrictEqual(
          errors.map((error) => error._tag),
          ["GitManagerError", "GitCommandError"],
        );
        assert.match(errors[0].message, /inside another git repository/);
        assert.strictEqual(git(projectRoot, "status", "--porcelain"), outerBefore);
        assert.strictEqual(git(projectRoot, "rev-parse", "--verify", "-q", "HEAD"), "");

        const plain = `${tmpOutside}/plain`;
        yield* fs.makeDirectory(plain);
        yield* KnownWorkspaces.KnownWorkspaces.pipe(
          Effect.flatMap((known) => known.assertRepositoryRoot(plain)),
        );
      }).pipe(Effect.provide(layer(projectRoot, baseDir)));
    }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("allows a write at a project root that sits inside a larger repo", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const monorepo = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cwd-guard-mono-" });
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-cwd-guard-base-" });
    const packageRoot = `${monorepo}/packages/app`;
    yield* fs.makeDirectory(packageRoot, { recursive: true });
    git(monorepo, "init", "-q");

    yield* Effect.gen(function* () {
      const guard = makeGitCwdGuard(yield* KnownWorkspaces.KnownWorkspaces);
      yield* guard.asGitManagerWrite("test", packageRoot);
    }).pipe(Effect.provide(layer(packageRoot, baseDir)));
  }).pipe(Effect.provide(NodeServices.layer)),
);

const wsSource = NodeFS.readFileSync(new URL("../ws.ts", import.meta.url), "utf8");

const handlerBody = (method: string) => {
  const start = wsSource.indexOf(`[WS_METHODS.${method}]:`);
  assert.isAbove(start, -1, `${method} handler exists`);
  const next = wsSource.indexOf("\n        [WS_METHODS.", start + 1);
  return wsSource.slice(start, next === -1 ? undefined : next);
};

it("keeps the cwd guard off project creation, clone, scheduled task, Claude Desktop sync and environment flows", () => {
  for (const method of [
    "projectsCreateNew",
    "projectsEnsureScratch",
    "projectsMutate",
    "projectCloneStart",
    "projectCloneRetry",
    "sourceControlCloneRepository",
    "sourceControlPublishRepository",
    "scheduledTasksUpsert",
    "scheduledTasksRunNow",
    "claudeDesktopSyncRun",
    "serverGetConfig",
  ]) {
    assert.notInclude(handlerBody(method), "gitCwdGuard", `${method} stays unguarded`);
  }
});

it("guards every git and vcs write handler, vcs.init included, so only known folders reach git", () => {
  for (const method of [
    "vcsInit",
    "vcsPull",
    "vcsCreateWorktree",
    "vcsRemoveWorktree",
    "vcsCreateRef",
    "vcsSwitchRef",
    "gitRunStackedAction",
    "gitPreparePullRequestThread",
  ]) {
    assert.include(handlerBody(method), "gitCwdGuard", `${method} is guarded`);
  }
});
