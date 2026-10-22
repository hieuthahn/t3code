import {
  DesktopForkUpdateCheckSchema,
  DesktopForkUpdateGateSchema,
  DesktopForkUpdateRunSchema,
  type DesktopForkUpdateState,
  type DesktopForkUpdateTrack,
  DesktopForkUpdateTrackSchema,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DesktopConfig from "../app/DesktopConfig.ts";

const UpdaterStatusJson = Schema.fromJsonString(
  Schema.Struct({
    head: Schema.String,
    branch: Schema.String,
    track: Schema.optionalKey(DesktopForkUpdateTrackSchema),
    paused: Schema.Boolean,
    activeRuns: Schema.Number,
    applyRunning: Schema.Boolean,
    check: Schema.NullOr(DesktopForkUpdateCheckSchema),
    lastRun: Schema.NullOr(DesktopForkUpdateRunSchema),
    gate: Schema.optionalKey(Schema.NullOr(DesktopForkUpdateGateSchema)),
  }),
);
const decodeUpdaterStatus = Schema.decodeEffect(UpdaterStatusJson);

const EXIT_MESSAGES: Readonly<Record<number, string>> = {
  10: "An update is already running.",
  11: "Agent runs are active. Update when they finish.",
  15: "The security gate stopped this update. See its report under Version.",
};

const TIMEOUTS = {
  status: Duration.seconds(30),
  check: Duration.minutes(2),
  launch: Duration.seconds(30),
  pause: Duration.seconds(30),
  track: Duration.seconds(30),
} as const;

const DISABLED_STATE: DesktopForkUpdateState = {
  enabled: false,
  head: "",
  branch: "",
  track: "preview",
  paused: false,
  activeRuns: 0,
  applyRunning: false,
  check: null,
  lastRun: null,
  error: null,
};

/** Give the updater a plain login environment, so nothing Electron sets leaks into the build it runs. */
export const updaterEnvironment = (env: NodeJS.ProcessEnv): Record<string, string> => {
  const kept: Record<string, string> = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
  for (const key of ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG"] as const) {
    const value = env[key];
    if (value !== undefined) kept[key] = value;
  }
  return kept;
};

const lastJsonLine = (stdout: string) =>
  stdout
    .split("\n")
    .map((line) => line.trim())
    .findLast((line) => line.startsWith("{")) ?? "";

const runUpdater = Effect.fn("desktop.forkUpdates.run")(function* (
  command: keyof typeof TIMEOUTS,
  args: ReadonlyArray<string>,
) {
  const config = yield* DesktopConfig.DesktopConfig;
  if (Option.isNone(config.forkUpdaterPath)) return DISABLED_STATE;
  const updaterPath = config.forkUpdaterPath.value;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* Effect.annotateCurrentSpan({ updaterPath, args: args.join(" ") });
  const failed = (error: string): DesktopForkUpdateState => ({
    ...DISABLED_STATE,
    enabled: true,
    error,
  });
  const outcome = yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(updaterPath, [...args], {
          stdin: "ignore",
          stderr: "ignore",
          env: updaterEnvironment(process.env),
          extendEnv: false,
        }),
      );
      yield* Effect.logInfo("Fork updater started.", { args: args.join(" "), pid: handle.pid });
      const [stdout, exitCode] = yield* Effect.all(
        [handle.stdout.pipe(Stream.decodeText(), Stream.mkString), handle.exitCode],
        { concurrency: "unbounded" },
      );
      return { stdout, exitCode };
    }),
  ).pipe(Effect.timeout(TIMEOUTS[command]), Effect.result);
  if (outcome._tag === "Failure") {
    yield* Effect.logWarning("Fork updater did not finish.", { cause: String(outcome.failure) });
    return failed(`t3-update ${args.join(" ")} did not finish: ${String(outcome.failure)}`);
  }
  const { stdout, exitCode } = outcome.success;
  for (const line of stdout.split("\n")) {
    if (line.trim().length > 0 && !line.trim().startsWith("{")) {
      yield* Effect.logInfo("Fork updater output.", { line });
    }
  }
  yield* Effect.logInfo("Fork updater exited.", { exitCode });
  const status = yield* decodeUpdaterStatus(lastJsonLine(stdout)).pipe(Effect.option);
  if (Option.isNone(status)) {
    return failed(`t3-update ${args.join(" ")} exited with ${exitCode} and printed no status.`);
  }
  const exitMessage =
    exitCode === 0
      ? null
      : (EXIT_MESSAGES[exitCode] ?? `t3-update ${args.join(" ")} exited with ${exitCode}.`);
  return {
    ...status.value,
    track: status.value.track ?? "preview",
    enabled: true,
    error: exitMessage,
  };
});

export const getState = runUpdater("status", ["status"]);
export const check = runUpdater("check", ["check", "--json"]);
export const apply = runUpdater("launch", ["launch"]);
export const setPaused = (paused: boolean) =>
  runUpdater("pause", ["pause", paused ? "on" : "off", "--json"]);
export const setTrack = (track: DesktopForkUpdateTrack) =>
  runUpdater("track", ["track", track, "--json"]);
