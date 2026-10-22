import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  applyClaudeSharedConfig,
  planClaudeSharedConfig,
  syncClaudeSharedMcpServers,
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
      const actions = yield* planClaudeSharedConfig({ enabled: true, sourceDir, targetDir });
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
      const again = yield* planClaudeSharedConfig({ enabled: true, sourceDir, targetDir });
      assert.deepEqual(kinds(again), {});
    }),
  );

  it.effect("reports a real file at the target as a conflict and leaves it alone", () =>
    Effect.gen(function* () {
      const { fs, path, sourceDir, targetDir } = yield* makeHomes;
      yield* fs.writeFileString(path.join(targetDir, "settings.json"), '{"own":true}');
      const actions = yield* planClaudeSharedConfig({ enabled: true, sourceDir, targetDir });
      assert.strictEqual(kinds(actions)["settings.json"], "conflict");
      yield* applyClaudeSharedConfig(actions);
      assert.strictEqual(
        yield* fs.readFileString(path.join(targetDir, "settings.json")),
        '{"own":true}',
      );
    }),
  );

  it.effect("removes only its own links when sharing is turned off", () =>
    Effect.gen(function* () {
      const { fs, path, tempDir, sourceDir, targetDir } = yield* makeHomes;
      yield* applyClaudeSharedConfig(
        yield* planClaudeSharedConfig({ enabled: true, sourceDir, targetDir }),
      );
      const foreign = path.join(tempDir, "foreign-agents");
      yield* fs.makeDirectory(foreign);
      yield* fs.symlink(foreign, path.join(targetDir, "agents"));
      const actions = yield* planClaudeSharedConfig({ enabled: false, sourceDir, targetDir });
      assert.deepEqual(kinds(actions), {
        "settings.json": "unlink",
        skills: "unlink",
        plugins: "unlink",
      });
      yield* applyClaudeSharedConfig(actions);
      assert.isFalse(yield* fs.exists(path.join(targetDir, "skills")));
      assert.isTrue(yield* fs.exists(path.join(sourceDir, "skills")));
      assert.strictEqual(yield* fs.readLink(path.join(targetDir, "agents")), foreign);
    }),
  );

  it.effect("does nothing when the instance uses the default home", () =>
    Effect.gen(function* () {
      const { sourceDir } = yield* makeHomes;
      const actions = yield* planClaudeSharedConfig({
        enabled: true,
        sourceDir,
        targetDir: sourceDir,
      });
      assert.deepEqual(kinds(actions), {});
    }),
  );

  it.effect("copies MCP servers and keeps the rest of the account config", () =>
    Effect.gen(function* () {
      const { fs, path, tempDir, targetDir } = yield* makeHomes;
      const sourceConfigFile = path.join(tempDir, "main.claude.json");
      const targetConfigFile = path.join(targetDir, ".claude.json");
      yield* fs.writeFileString(
        sourceConfigFile,
        JSON.stringify({ mcpServers: { docs: { command: "docs-mcp" } }, oauthAccount: "main" }),
      );
      yield* fs.writeFileString(
        targetConfigFile,
        JSON.stringify({ oauthAccount: "account", mcpServers: {} }),
      );
      assert.strictEqual(
        yield* syncClaudeSharedMcpServers({ sourceConfigFile, targetConfigFile }),
        "updated",
      );
      assert.deepEqual(JSON.parse(yield* fs.readFileString(targetConfigFile)), {
        oauthAccount: "account",
        mcpServers: { docs: { command: "docs-mcp" } },
      });
      assert.strictEqual(
        yield* syncClaudeSharedMcpServers({ sourceConfigFile, targetConfigFile }),
        "unchanged",
      );
    }),
  );

  it.effect("skips MCP sync before the account has logged in", () =>
    Effect.gen(function* () {
      const { fs, path, tempDir, targetDir } = yield* makeHomes;
      const sourceConfigFile = path.join(tempDir, "main.claude.json");
      yield* fs.writeFileString(sourceConfigFile, JSON.stringify({ mcpServers: {} }));
      assert.strictEqual(
        yield* syncClaudeSharedMcpServers({
          sourceConfigFile,
          targetConfigFile: path.join(targetDir, ".claude.json"),
        }),
        "skipped",
      );
    }),
  );
});
