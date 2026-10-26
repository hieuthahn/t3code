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
      Layer.mock(GitVcsDriver.GitVcsDriver)({ listWorktreePaths: () => Effect.succeed([]) }),
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
