import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopForkUpdates from "./DesktopForkUpdates.ts";

const STATUS = {
  head: "b405b9104f",
  branch: "feat/shared-history-continuation",
  paused: false,
  activeRuns: 0,
  applyRunning: false,
  check: {
    checkedAt: "2026-10-22T05:25:50Z",
    head: "b405b9104f",
    upstreamHead: "3b95e7831b",
    newCommits: 7,
    overlapFiles: ["apps/web/src/components/ChatView.tsx"],
    conflictFiles: [],
    riskyFiles: [],
  },
  lastRun: null,
};

const fakeUpdater = (recordPath: string, exitCode: number, output: string) => `#!/bin/sh
echo "$@" >> ${JSON.stringify(recordPath)}
env >> ${JSON.stringify(recordPath)}
echo "[2026-10-22 12:00:00] upstream has 7 new commits."
printf '%s\\n' ${JSON.stringify(output)}
exit ${exitCode}
`;

const withUpdater = <A, E>(
  exitCode: number,
  output: string,
  run: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "fork-updater-" });
    const updaterPath = path.join(directory, "t3-update");
    const recordPath = path.join(directory, "record.log");
    yield* fileSystem.writeFileString(updaterPath, fakeUpdater(recordPath, exitCode, output));
    yield* fileSystem.chmod(updaterPath, 0o755);
    const state = yield* run.pipe(
      Effect.provide(
        DesktopConfig.layerTest({ T3CODE_FORK_UPDATER: updaterPath, HOME: "/Users/someone" }),
      ),
    );
    const record = yield* fileSystem.readFileString(recordPath);
    return { state, record };
  });

it.effect("reports the updater as disabled when the app sets no updater path", () =>
  Effect.gen(function* () {
    const state = yield* DesktopForkUpdates.getState.pipe(
      Effect.provide(DesktopConfig.layerTest({})),
    );
    assert.isFalse(state.enabled);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("reads the status the updater prints after its log lines", () =>
  Effect.gen(function* () {
    const { state, record } = yield* withUpdater(
      0,
      JSON.stringify(STATUS),
      DesktopForkUpdates.check,
    );
    assert.isTrue(state.enabled);
    assert.isNull(state.error);
    assert.equal(state.check?.newCommits, 7);
    assert.include(record, "check --json");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("runs the updater with a plain environment", () =>
  Effect.gen(function* () {
    const previous = process.env.ELECTRON_RUN_AS_NODE;
    process.env.ELECTRON_RUN_AS_NODE = "1";
    const { record } = yield* withUpdater(
      0,
      JSON.stringify(STATUS),
      DesktopForkUpdates.getState,
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
          else process.env.ELECTRON_RUN_AS_NODE = previous;
        }),
      ),
    );
    assert.notInclude(record, "ELECTRON_RUN_AS_NODE");
    assert.include(record, "PATH=/usr/bin:/bin:/usr/sbin:/sbin");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("explains a refused update and still returns the status", () =>
  Effect.gen(function* () {
    const { state, record } = yield* withUpdater(
      11,
      JSON.stringify({ ...STATUS, activeRuns: 2 }),
      DesktopForkUpdates.apply,
    );
    assert.include(record, "launch");
    assert.equal(state.activeRuns, 2);
    assert.equal(state.error, "Agent runs are active. Update when they finish.");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("reports an updater that prints no status", () =>
  Effect.gen(function* () {
    const { state } = yield* withUpdater(2, "fetch failed", DesktopForkUpdates.setPaused(true));
    assert.isTrue(state.enabled);
    assert.equal(state.error, "t3-update pause on --json exited with 2 and printed no status.");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
