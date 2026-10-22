import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, type ProviderAuthState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { makeCodexCliAuth } from "./CodexCliAuth.ts";

const AUTHORIZE_URL =
  "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_test&state=abc";

type FakeOutcome = "succeed" | "port-taken" | "hang";

const fakeCliSource = (recordPath: string, outcome: FakeOutcome) => `#!/usr/bin/env node
const fs = require("node:fs");
const record = (line) => fs.appendFileSync(${JSON.stringify(recordPath)}, line + "\\n");
record("args=" + process.argv.slice(2).join(" "));
record("home=" + (process.env.CODEX_HOME ?? ""));
record("browser=" + (process.env.BROWSER ?? ""));
if (${JSON.stringify(outcome)} === "port-taken") {
  process.stderr.write("Error: failed to start login server: Address already in use\\n");
  process.exit(1);
}
process.stdout.write("Starting local login server on http://localhost:1455.\\n");
process.stdout.write("If your browser did not open, navigate to this URL to authenticate:\\n\\n${AUTHORIZE_URL}\\n");
if (${JSON.stringify(outcome)} === "succeed") {
  setTimeout(() => { process.stdout.write("Successfully logged in\\n"); process.exit(0); }, 200);
} else {
  process.on("SIGTERM", () => { record("signal=SIGTERM"); process.exit(143); });
  setInterval(() => {}, 1000);
}
`;

const settledState = (stream: Stream.Stream<ProviderAuthState>) =>
  stream.pipe(
    Stream.filter((state) => state.phase === "succeeded" || state.phase === "failed"),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
    Effect.timeout("5 seconds"),
  );

const setUp = (outcome: FakeOutcome) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "codex-auth-flow-" });
    const codexHome = path.join(directory, "shadow-home");
    const recordPath = path.join(directory, "record.log");
    const binaryPath = path.join(directory, "codex");
    yield* fileSystem.writeFileString(binaryPath, fakeCliSource(recordPath, outcome));
    yield* fileSystem.chmod(binaryPath, 0o755);
    const changes: Array<boolean> = [];
    const controller = yield* makeCodexCliAuth({
      instanceId: ProviderInstanceId.make("codex_test"),
      binaryPath,
      codexHome,
      environment: { PATH: process.env.PATH },
      onChanged: (signedIn) => Effect.sync(() => changes.push(signedIn)),
    });
    const readRecord = fileSystem.readFileString(recordPath);
    return { controller, codexHome, readRecord, changes };
  });

it.effect("signs in under the instance's CODEX_HOME once the CLI confirms", () =>
  Effect.gen(function* () {
    const { controller, codexHome, readRecord, changes } = yield* setUp("succeed");
    yield* controller.start("owner");
    const waiting = yield* controller.subscribe("owner").pipe(
      Stream.filter((state) => state.phase === "waiting"),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
      Effect.timeout("5 seconds"),
    );
    assert.equal(waiting.authorizationUrl, AUTHORIZE_URL);
    assert.deepInclude(waiting.interaction, { type: "browser", requiresConsent: false });
    const settled = yield* settledState(controller.subscribe("owner"));
    const record = yield* readRecord;
    assert.equal(settled.phase, "succeeded");
    assert.include(record, "args=login\n");
    assert.include(record, `home=${codexHome}\n`);
    assert.include(record, "browser=true\n");
    assert.deepEqual(changes, [true]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("reports the CLI's last line when the login server cannot start", () =>
  Effect.gen(function* () {
    const { controller, changes } = yield* setUp("port-taken");
    yield* controller.start("owner");
    const settled = yield* settledState(controller.subscribe("owner"));
    assert.equal(settled.phase, "failed");
    assert.include(settled.message ?? "", "failed to start login server");
    assert.deepEqual(changes, []);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("stops the CLI when the sign-in is cancelled", () =>
  Effect.gen(function* () {
    const { controller, readRecord } = yield* setUp("hang");
    const started = yield* controller.start("owner");
    yield* controller.subscribe("owner").pipe(
      Stream.filter((state) => state.phase === "waiting"),
      Stream.runHead,
      Effect.timeout("5 seconds"),
    );
    yield* controller.cancel("owner", started.flowId!);
    assert.include(yield* readRecord, "signal=SIGTERM\n");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
