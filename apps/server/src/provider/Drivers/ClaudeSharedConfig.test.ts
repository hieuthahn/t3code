import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  applyClaudeSharedConfig,
  planClaudeSharedConfig,
  syncClaudeSharedConfig,
} from "./ClaudeSharedConfig.ts";

const makeHomes = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-shared-" });
  const sourceDir = path.join(tempDir, "main");
  const targetDir = path.join(tempDir, "account");
  yield* fs.makeDirectory(path.join(sourceDir, "skills"), { recursive: true });
  yield* fs.makeDirectory(path.join(sourceDir, "plugins"), { recursive: true });
  yield* fs.writeFileString(path.join(sourceDir, "settings.json"), "{}");
  yield* fs.makeDirectory(targetDir, { recursive: true });
  return { fs, path, tempDir, sourceDir, targetDir };
});

const kinds = (actions: ReadonlyArray<{ readonly kind: string; readonly entry: string }>) =>
  Object.fromEntries(actions.filter((a) => a.kind !== "keep").map((a) => [a.entry, a.kind]));

it.layer(NodeServices.layer)("ClaudeSharedConfig", (it) => {
  it.effect("links only entries the default home has", () =>
    Effect.gen(function* () {
      const { fs, path, sourceDir, targetDir } = yield* makeHomes;
      const actions = yield* planClaudeSharedConfig({ sourceDir, targetDir });
      assert.deepEqual(kinds(actions), {
        "settings.json": "link",
        skills: "link",
        plugins: "link",
      });
      yield* applyClaudeSharedConfig(actions);
      assert.strictEqual(
        yield* fs.readLink(path.join(targetDir, "skills")),
        path.join(sourceDir, "skills"),
      );
      const again = yield* planClaudeSharedConfig({ sourceDir, targetDir });
      assert.deepEqual(kinds(again), {});
    }),
  );

  it.effect("reports a real file at the target as a conflict and leaves it alone", () =>
    Effect.gen(function* () {
      const { fs, path, sourceDir, targetDir } = yield* makeHomes;
      yield* fs.writeFileString(path.join(targetDir, "settings.json"), '{"own":true}');
      const actions = yield* planClaudeSharedConfig({ sourceDir, targetDir });
      assert.strictEqual(kinds(actions)["settings.json"], "conflict");
      yield* applyClaudeSharedConfig(actions);
      assert.strictEqual(
        yield* fs.readFileString(path.join(targetDir, "settings.json")),
        '{"own":true}',
      );
    }),
  );

  it.effect("keeps a link another tool made to the same entry through a different path", () =>
    Effect.gen(function* () {
      const { fs, path, tempDir, sourceDir, targetDir } = yield* makeHomes;
      const alias = path.join(tempDir, "main-alias");
      yield* fs.symlink(sourceDir, alias);
      yield* fs.symlink(path.join(alias, "skills"), path.join(targetDir, "skills"));
      const actions = yield* planClaudeSharedConfig({ sourceDir, targetDir });
      assert.deepEqual(kinds(actions), { "settings.json": "link", plugins: "link" });
    }),
  );

  it.effect("leaves every entry alone when sharing is off", () =>
    Effect.gen(function* () {
      const { fs, path, sourceDir, targetDir } = yield* makeHomes;
      yield* fs.symlink(path.join(sourceDir, "skills"), path.join(targetDir, "skills"));
      yield* syncClaudeSharedConfig({ enabled: false, sourceDir, targetDir });
      assert.strictEqual(
        yield* fs.readLink(path.join(targetDir, "skills")),
        path.join(sourceDir, "skills"),
      );
      assert.isFalse(yield* fs.exists(path.join(targetDir, "settings.json")));
    }),
  );

  it.effect("does nothing when the instance uses the default home", () =>
    Effect.gen(function* () {
      const { sourceDir } = yield* makeHomes;
      const actions = yield* planClaudeSharedConfig({
        sourceDir,
        targetDir: sourceDir,
      });
      assert.deepEqual(kinds(actions), {});
    }),
  );
});
