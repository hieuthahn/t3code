import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, type ProviderAuthState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { makeClaudeAuth } from "./ClaudeAuth.ts";

const AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize?code=true&client_id=test";

const fakeCliSource = (recordPath: string, exitCodeOnCode: number) => `#!/usr/bin/env node
const fs = require("node:fs");
const record = (line) => fs.appendFileSync(${JSON.stringify(recordPath)}, line + "\\n");
record("config=" + (process.env.CLAUDE_CONFIG_DIR ?? ""));
process.stdout.write("If the browser didn't open, visit: ${AUTHORIZE_URL}\\n");
let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (!input.includes("\\n")) return;
  record("code=" + input.trim());
  if (${exitCodeOnCode} > 0) process.stderr.write("Login failed: Request failed with status code 400\\n");
  if (${exitCodeOnCode} >= 0) process.exit(${exitCodeOnCode});
});
`;

const runSignIn = (exitCodeOnCode: number, options: { readonly useHomePath: boolean }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "claude-auth-flow-" });
    const configDir = path.join(directory, "account-home");
    const recordPath = path.join(directory, "record.log");
    const binaryPath = path.join(directory, "claude");
    yield* fileSystem.writeFileString(binaryPath, fakeCliSource(recordPath, exitCodeOnCode));
    yield* fileSystem.chmod(binaryPath, 0o755);
    const controller = yield* makeClaudeAuth({
      instanceId: ProviderInstanceId.make("claudeAgent_test"),
      binaryPath,
      homePath: options.useHomePath ? configDir : "",
      configDir,
      environment: { PATH: process.env.PATH },
      onChanged: () => Effect.void,
    });
    const started = yield* controller.start("owner");
    const waiting = yield* controller.subscribe("owner").pipe(
      Stream.filter((state) => state.phase === "waiting"),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
      Effect.timeout("5 seconds"),
    );
    assert.equal(waiting.authorizationUrl, AUTHORIZE_URL);
    yield* controller.complete("owner", { flowId: started.flowId!, callbackUrl: "the-code#state" });
    const settled: ProviderAuthState = yield* controller.subscribe("owner").pipe(
      Stream.filter((state) => state.phase === "succeeded" || state.phase === "failed"),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
      Effect.timeout("5 seconds"),
    );
    const record = yield* fileSystem.readFileString(recordPath);
    return { settled, record, configDir };
  });

it.effect("signs in with the instance's config directory and the submitted code", () =>
  Effect.gen(function* () {
    const { settled, record, configDir } = yield* runSignIn(0, { useHomePath: true });
    assert.include(record, `config=${configDir}`);
    assert.include(record, "code=the-code#state");
    assert.equal(settled.phase, "succeeded");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("leaves the default home to the CLI when the instance sets no home path", () =>
  Effect.gen(function* () {
    const { record } = yield* runSignIn(0, { useHomePath: false });
    assert.include(record, "config=\n");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
