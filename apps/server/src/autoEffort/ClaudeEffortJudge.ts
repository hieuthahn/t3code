import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import type { ClaudeSettings } from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import {
  hasClaudeManagedMcpConfig,
  makeClaudeEnvironment,
} from "../provider/Drivers/ClaudeHome.ts";
import { JUDGE_SYSTEM } from "./autoEffortJudgment.ts";

const JUDGE_MODEL = "claude-haiku-5-5";

export interface ClaudeEffortJudge {
  /** The judge's raw reply, or none when the process could not answer. */
  readonly ask: (question: string) => Effect.Effect<Option.Option<string>>;
  /** Starts the next process now rather than on the first question. */
  readonly prewarm: Effect.Effect<void>;
}

interface WarmProcess {
  readonly scope: Scope.Closeable;
  readonly input: Queue.Queue<string>;
  readonly answer: Deferred.Deferred<string>;
}

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** The text of the first assistant message in a stream-json line. */
export function assistantText(line: string): string | undefined {
  const message = Option.getOrUndefined(decodeLine(line));
  if (typeof message !== "object" || message === null) return undefined;
  const record = message as { type?: unknown; message?: { content?: unknown }; result?: unknown };
  if (record.type === "result" && typeof record.result === "string" && record.result !== "") {
    return record.result;
  }
  if (record.type !== "assistant" || !Array.isArray(record.message?.content)) return undefined;
  const text = record.message.content
    .map((part: { text?: unknown }) => (typeof part.text === "string" ? part.text : ""))
    .join("");
  return text.trim() === "" ? undefined : text;
}

/**
 * Keeps one `claude -p` started and idle per enabled account from start-up, so a judgment costs
 * a model round trip rather than a CLI boot. Each process answers one question: a reused session
 * would carry another thread's conversation into the next verdict.
 */
export const makeClaudeEffortJudge = Effect.fn("makeClaudeEffortJudge")(function* (
  claudeSettings: ClaudeSettings,
  environment?: NodeJS.ProcessEnv,
  options?: {
    readonly systemPrompt?: string;
    /** False starts the first process on the first question instead of at start-up. */
    readonly warmAtStart?: boolean;
  },
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const instanceScope = yield* Effect.scope;
  const claudeEnvironment = yield* makeClaudeEnvironment(claudeSettings, environment);
  const warmRef = yield* Ref.make(Option.none<WarmProcess>());

  const spawnWarm = Effect.gen(function* () {
    const scope = yield* Scope.fork(instanceScope);
    const started = Effect.gen(function* () {
      const input = yield* Queue.unbounded<string>();
      const answer = yield* Deferred.make<string>();
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-effort-judge-" });
      const managedMcpConfig = yield* hasClaudeManagedMcpConfig();
      const spawnCommand = yield* resolveSpawnCommand(
        claudeSettings.binaryPath || "claude",
        [
          "-p",
          "--model",
          JUDGE_MODEL,
          "--effort",
          "low",
          "--system-prompt",
          options?.systemPrompt ?? JUDGE_SYSTEM,
          "--tools",
          "",
          "--disable-slash-commands",
          // Claude refuses this flag next to a managed-mcp.json, which already keeps the
          // user's own MCP servers out.
          ...(managedMcpConfig ? [] : ["--strict-mcp-config"]),
          "--setting-sources",
          "",
          "--settings",
          encodeJson({ disableAllHooks: true }),
          "--no-session-persistence",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--verbose",
        ],
        { env: claudeEnvironment },
      );
      const child = yield* spawner.spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          env: claudeEnvironment,
          cwd,
          shell: spawnCommand.shell,
          stdin: { stream: Stream.fromQueue(input).pipe(Stream.encodeText) },
          forceKillAfter: "1 second",
        }),
      );
      yield* child.stdout.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runForEach((line) => {
          const text = assistantText(line);
          return text === undefined ? Effect.void : Deferred.succeed(answer, text);
        }),
        Effect.ignore,
        Effect.forkScoped,
      );
      yield* child.stderr.pipe(Stream.runDrain, Effect.ignore, Effect.forkScoped);
      return { scope, input, answer } satisfies WarmProcess;
    }).pipe(Scope.provide(scope));
    return yield* started.pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
  }).pipe(Effect.provideService(FileSystem.FileSystem, fileSystem));

  const replaceWarm = spawnWarm.pipe(
    Effect.flatMap((next) => Ref.getAndSet(warmRef, Option.some(next))),
    Effect.flatMap((displaced) =>
      Option.isSome(displaced) ? Scope.close(displaced.value.scope, Exit.void) : Effect.void,
    ),
    Effect.ignore,
  );

  // A cold start takes seconds and runs uninterruptibly, so it never happens on a judged turn:
  // that turn falls back while the next process boots.
  const take = Ref.getAndSet(warmRef, Option.none()).pipe(
    Effect.tap(() => Effect.forkIn(replaceWarm, instanceScope)),
  );

  const answer = (warm: WarmProcess, question: string) =>
    Effect.acquireUseRelease(
      Effect.succeed(warm),
      () =>
        Queue.offer(
          warm.input,
          `${encodeJson({ type: "user", message: { role: "user", content: question } })}\n`,
        ).pipe(Effect.andThen(Deferred.await(warm.answer)), Effect.map(Option.some)),
      () => Scope.close(warm.scope, Exit.void),
    );

  if (claudeSettings.enabled && options?.warmAtStart !== false) {
    yield* Effect.forkIn(replaceWarm, instanceScope);
  }

  return {
    prewarm: replaceWarm,
    ask: (question) =>
      take.pipe(
        Effect.flatMap((current) =>
          Option.isSome(current)
            ? answer(current.value, question)
            : Effect.succeed(Option.none<string>()),
        ),
        Effect.catch(() => Effect.succeed(Option.none<string>())),
      ),
  } satisfies ClaudeEffortJudge;
});
