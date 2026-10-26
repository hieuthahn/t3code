import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import type { GitCommandError } from "@t3tools/contracts";
import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";

const layerTest = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-nested-worktrees-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

const git = (cwd: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    const result = yield* driver.execute({
      operation: "GitVcsDriverNestedWorktrees.test.git",
      cwd,
      args,
      ...(env ? { env } : {}),
      timeoutMs: 30_000,
    });
    return result.stdout.trim();
  });

const worktreeCount = (cwd: string) =>
  git(cwd, ["worktree", "list", "--porcelain"]).pipe(
    Effect.map(
      (output) => output.split("\n").filter((line) => line.startsWith("worktree ")).length,
    ),
  );

const initRepository = Effect.fn("initRepository")(function* (cwd: string, withCommit = true) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(cwd, { recursive: true });
  yield* git(cwd, ["init", "-q"]);
  yield* git(cwd, ["config", "user.email", "test@test.com"]);
  yield* git(cwd, ["config", "user.name", "Test"]);
  if (!withCommit) return;
  yield* fileSystem.writeFileString(path.join(cwd, "README.md"), "# repo\n");
  yield* git(cwd, ["add", "."]);
  yield* git(cwd, ["commit", "-q", "-m", "initial"]);
});

/** An outer repository whose gitignored inner repositories sit at `inner`, like a hora project. */
const makeProject = Effect.fn("makeProject")(function* (inner: ReadonlyArray<string>) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const parent = yield* fileSystem.makeTempDirectoryScoped({ prefix: "nested-worktrees-" });
  const root = path.join(parent, "outer");
  yield* initRepository(root);
  yield* fileSystem.writeFileString(
    path.join(root, ".gitignore"),
    inner.map((entry) => `/${entry}/\n`).join(""),
  );
  yield* git(root, ["add", "."]);
  yield* git(root, ["commit", "-q", "-m", "ignore inner"]);
  for (const entry of inner) yield* initRepository(path.join(root, entry));
  const worktrees = path.join(parent, "worktrees");
  return { root, worktrees, worktreePath: (name: string) => path.join(worktrees, name) };
});

const baseRef = (root: string) => git(root, ["branch", "--show-current"]);

describe("nested repository worktrees", () => {
  it.layer(layerTest)("createWorktree and removeWorktree", (it) => {
    it.effect("creates and removes a worktree of every gitignored inner repository", () =>
      Effect.gen(function* () {
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const project = yield* makeProject(["alpha", "services/beta"]);
        const target = project.worktreePath("feature-x");

        yield* driver.createWorktree({
          cwd: project.root,
          path: target,
          refName: yield* baseRef(project.root),
          newRefName: "feature/x",
        });

        for (const entry of ["alpha", "services/beta"]) {
          const inner = path.join(target, entry);
          assert.isTrue(yield* fileSystem.exists(path.join(inner, "README.md")));
          assert.equal(yield* git(inner, ["branch", "--show-current"]), "feature/x");
          assert.equal(
            yield* git(inner, ["rev-parse", "HEAD"]),
            yield* git(path.join(project.root, entry), ["rev-parse", "HEAD"]),
          );
          assert.equal(yield* worktreeCount(path.join(project.root, entry)), 2);
        }

        const removed = yield* driver.removeWorktree({ cwd: project.root, path: target });
        assert.equal(removed.dirtyNestedRepositories, 0);
        assert.isFalse(yield* fileSystem.exists(target));
        for (const entry of ["alpha", "services/beta"]) {
          assert.equal(yield* worktreeCount(path.join(project.root, entry)), 1);
          assert.include(
            yield* git(path.join(project.root, entry), ["branch", "--list", "feature/x"]),
            "feature/x",
          );
        }
      }),
    );

    it.effect("names the inner branch with the outer's suffix rule when it already exists", () =>
      Effect.gen(function* () {
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const path = yield* Path.Path;
        const project = yield* makeProject(["alpha"]);
        const inner = path.join(project.root, "alpha");
        yield* git(inner, ["branch", "feature-taken"]);
        const target = project.worktreePath("taken");

        yield* driver.createWorktree({
          cwd: project.root,
          path: target,
          refName: yield* baseRef(project.root),
          newRefName: "feature-taken",
        });

        assert.equal(
          yield* git(path.join(target, "alpha"), ["branch", "--show-current"]),
          "feature-taken-1",
        );
      }),
    );

    it.effect("skips an inner repository with no commits", () =>
      Effect.gen(function* () {
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const project = yield* makeProject(["alpha"]);
        yield* initRepository(path.join(project.root, "empty"), false);
        yield* fileSystem.writeFileString(
          path.join(project.root, ".gitignore"),
          "/alpha/\n/empty/\n",
        );
        const target = project.worktreePath("empty-inner");

        yield* driver.createWorktree({
          cwd: project.root,
          path: target,
          refName: yield* baseRef(project.root),
          newRefName: "feature/empty",
        });

        assert.isTrue(yield* fileSystem.exists(path.join(target, "alpha", "README.md")));
        assert.isFalse(yield* fileSystem.exists(path.join(target, "empty")));
      }),
    );

    it.effect("branches an inner repository that sits on a detached HEAD", () =>
      Effect.gen(function* () {
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const path = yield* Path.Path;
        const project = yield* makeProject(["alpha"]);
        const inner = path.join(project.root, "alpha");
        yield* git(inner, ["checkout", "-q", "--detach"]);
        const target = project.worktreePath("detached");

        yield* driver.createWorktree({
          cwd: project.root,
          path: target,
          refName: yield* baseRef(project.root),
          newRefName: "feature/detached",
        });

        const created = path.join(target, "alpha");
        assert.equal(yield* git(created, ["branch", "--show-current"]), "feature/detached");
        assert.equal(
          yield* git(created, ["rev-parse", "HEAD"]),
          yield* git(inner, ["rev-parse", "HEAD"]),
        );
      }),
    );

    it.effect("does not make a worktree of a submodule git directory", () =>
      Effect.gen(function* () {
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const project = yield* makeProject(["alpha"]);
        const source = path.join(path.dirname(project.root), "sub-source");
        yield* initRepository(source);
        yield* fileSystem.makeDirectory(path.join(project.root, ".git/modules"), {
          recursive: true,
        });
        yield* git(path.dirname(project.root), [
          "clone",
          "-q",
          `--separate-git-dir=${path.join(project.root, ".git/modules/sub")}`,
          source,
          path.join(project.root, "sub"),
        ]);
        const target = project.worktreePath("with-submodule");

        yield* driver.createWorktree(
          {
            cwd: project.root,
            path: target,
            refName: yield* baseRef(project.root),
            newRefName: "feature/sub",
          },
          { submodules: "none" },
        );

        assert.isTrue(yield* fileSystem.exists(path.join(target, "alpha", "README.md")));
        assert.isFalse(yield* fileSystem.exists(path.join(target, "sub")));
        assert.equal(yield* worktreeCount(path.join(project.root, "sub")), 1);
        assert.equal(
          yield* git(path.join(project.root, "sub"), ["branch", "--list", "feature/sub"]),
          "",
        );
      }),
    );

    it.effect("rolls back the first inner worktree and the outer when a later one fails", () =>
      Effect.gen(function* () {
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const project = yield* makeProject(["alpha", "beta"]);
        // A `feature` branch makes `refs/heads/feature/x` impossible, so beta fails after alpha succeeded.
        yield* git(path.join(project.root, "beta"), ["branch", "feature"]);
        const target = project.worktreePath("rollback");

        const error: GitCommandError = yield* driver
          .createWorktree({
            cwd: project.root,
            path: target,
            refName: yield* baseRef(project.root),
            newRefName: "feature/x",
          })
          .pipe(Effect.flip);

        assert.equal(error.operation, "GitVcsDriver.createWorktree.nested");
        assert.isFalse(yield* fileSystem.exists(target));
        assert.equal(yield* worktreeCount(project.root), 1);
        assert.equal(yield* worktreeCount(path.join(project.root, "alpha")), 1);
        assert.equal(
          yield* git(path.join(project.root, "alpha"), ["branch", "--list", "feature/x"]),
          "",
        );
        assert.equal(yield* git(project.root, ["branch", "--list", "feature/x"]), "");
      }),
    );

    it.effect("refuses a dirty inner worktree without force, then counts it with force", () =>
      Effect.gen(function* () {
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const project = yield* makeProject(["alpha", "beta"]);
        const target = project.worktreePath("dirty");
        yield* driver.createWorktree({
          cwd: project.root,
          path: target,
          refName: yield* baseRef(project.root),
          newRefName: "feature/dirty",
        });
        yield* fileSystem.writeFileString(path.join(target, "beta", "scratch.txt"), "wip\n");

        const refusal = yield* driver
          .removeWorktree({ cwd: project.root, path: target })
          .pipe(Effect.flip);
        assert.include(refusal.detail, "contains modified or untracked files");
        assert.isTrue(yield* fileSystem.exists(path.join(target, "alpha", "README.md")));
        assert.equal(yield* worktreeCount(path.join(project.root, "alpha")), 2);

        const removed = yield* driver.removeWorktree({
          cwd: project.root,
          path: target,
          force: true,
        });
        assert.equal(removed.dirtyNestedRepositories, 1);
        assert.isFalse(yield* fileSystem.exists(target));
        assert.equal(yield* worktreeCount(path.join(project.root, "beta")), 1);
      }),
    );

    it.effect("prunes inner repositories when the worktree was deleted by hand", () =>
      Effect.gen(function* () {
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const project = yield* makeProject(["alpha"]);
        const target = project.worktreePath("by-hand");
        yield* driver.createWorktree({
          cwd: project.root,
          path: target,
          refName: yield* baseRef(project.root),
          newRefName: "feature/by-hand",
        });
        yield* fileSystem.remove(target, { recursive: true });

        const removed = yield* driver.removeWorktree({ cwd: project.root, path: target });

        assert.equal(removed.dirtyNestedRepositories, 0);
        assert.equal(yield* worktreeCount(project.root), 1);
        assert.equal(yield* worktreeCount(path.join(project.root, "alpha")), 1);
      }),
    );

    it.effect("takes the setting from the option, then t3.json, then the repository count", () =>
      Effect.gen(function* () {
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const project = yield* makeProject(["alpha", "beta"]);
        const refName = yield* baseRef(project.root);
        yield* fileSystem.writeFileString(
          path.join(project.root, "t3.json"),
          '{ "worktreeNestedRepositories": "none" }',
        );
        yield* git(project.root, ["add", "t3.json"]);
        yield* git(project.root, ["commit", "-q", "-m", "t3.json"]);

        const created = (
          name: string,
          nestedRepositories: Parameters<typeof driver.createWorktree>[1],
        ) =>
          Effect.gen(function* () {
            const target = project.worktreePath(name);
            yield* driver.createWorktree(
              { cwd: project.root, path: target, refName, newRefName: name },
              nestedRepositories,
            );
            return {
              alpha: yield* fileSystem.exists(path.join(target, "alpha", "README.md")),
              beta: yield* fileSystem.exists(path.join(target, "beta", "README.md")),
            };
          });

        assert.deepEqual(yield* created("from-file", {}), { alpha: false, beta: false });
        assert.deepEqual(yield* created("from-option-all", { nestedRepositories: "all" }), {
          alpha: true,
          beta: true,
        });
        assert.deepEqual(yield* created("from-option-list", { nestedRepositories: ["beta/"] }), {
          alpha: false,
          beta: true,
        });
      }),
    );

    it.effect("starts without inner worktrees above 8 repositories and creates 25 on request", () =>
      Effect.gen(function* () {
        const driver = yield* GitVcsDriver.GitVcsDriver;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const names = Array.from(
          { length: 25 },
          (_, index) => `repo-${String(index).padStart(2, "0")}`,
        );
        const project = yield* makeProject(names);
        const refName = yield* baseRef(project.root);

        const byDefault = project.worktreePath("default");
        yield* driver.createWorktree({
          cwd: project.root,
          path: byDefault,
          refName,
          newRefName: "feature/default",
        });
        assert.isFalse(yield* fileSystem.exists(path.join(byDefault, names[0]!)));

        const everything = project.worktreePath("everything");
        yield* driver.createWorktree(
          { cwd: project.root, path: everything, refName, newRefName: "feature/everything" },
          { nestedRepositories: "all" },
        );
        for (const name of names) {
          assert.isTrue(yield* fileSystem.exists(path.join(everything, name, "README.md")));
        }

        const removed = yield* driver.removeWorktree({ cwd: project.root, path: everything });
        assert.equal(removed.dirtyNestedRepositories, 0);
        assert.equal(yield* worktreeCount(path.join(project.root, names[24]!)), 1);
      }),
    );
  });
});
