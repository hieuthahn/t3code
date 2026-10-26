import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ClaudeSettings } from "@t3tools/contracts";
import { writeFakeCli } from "@t3tools/provider-testing/fakeCli";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { assistantText, makeClaudeEffortJudge } from "./ClaudeEffortJudge.ts";

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

// Answers each stream-json question with what the judge process saw, then waits like claude -p.
const FAKE_JUDGE = `
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
appendFileSync(process.env.CLAUDE_CONFIG_DIR + "/judge-starts", process.pid + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const question = JSON.parse(line).message.content;
  const seen = {
    question,
    configDir: process.env.CLAUDE_CONFIG_DIR,
    pid: process.pid,
    noPersistence: args.includes("--no-session-persistence"),
    judgePrompt: args[args.indexOf("--system-prompt") + 1]?.startsWith("You choose the reasoning effort"),
    systemPrompt: args[args.indexOf("--system-prompt") + 1],
  };
  process.stdout.write(JSON.stringify({ type: "system", subtype: "init" }) + "\\n");
  process.stdout.write(
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: JSON.stringify(seen) }] } }) + "\\n",
  );
});
`;

// Reads a question and never answers it, and outlives SIGTERM until the kill that follows.
const STUBBORN_JUDGE = `
import { appendFileSync } from "node:fs";
process.on("SIGTERM", () => {});
process.stdin.on("data", () => appendFileSync(process.env.CLAUDE_CONFIG_DIR + "/judge-asked", "1"));
`;

describe("assistantText", () => {
  it("takes the first assistant text and skips empty or unrelated lines", () => {
    expect(assistantText('{"type":"system","subtype":"init"}')).toBeUndefined();
    expect(assistantText('{"type":"assistant","message":{"content":[{"type":"thinking"}]}}')).toBe(
      undefined,
    );
    expect(
      assistantText('{"type":"assistant","message":{"content":[{"type":"text","text":"{}"}]}}'),
    ).toBe("{}");
    expect(assistantText('{"type":"result","result":"{\\"effort\\":\\"low\\"}"}')).toBe(
      '{"effort":"low"}',
    );
    expect(assistantText("not json")).toBeUndefined();
  });
});

describe("makeClaudeEffortJudge", () => {
  it.live(
    "falls back while cold, then answers through the account's config dir, one process each",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-effort-judge-test-" });
        const accountDir = path.join(dir, "account-viet");
        yield* fs.makeDirectory(accountDir);
        const binary = writeFakeCli({ directory: dir, name: "claude", source: FAKE_JUDGE });
        const judge = yield* makeClaudeEffortJudge(
          decodeClaudeSettings({ binaryPath: binary, homePath: accountDir, enabled: false }),
        );

        expect(Option.isNone(yield* judge.ask("cold"))).toBe(true);
        yield* judge.prewarm;
        const first = yield* judge.ask("rename x");
        yield* judge.prewarm;
        const second = yield* judge.ask("migrate everything");
        const seen = [first, second].map((reply) => JSON.parse(Option.getOrThrow(reply)));

        expect(seen.map((entry) => entry.question)).toEqual(["rename x", "migrate everything"]);
        for (const entry of seen) {
          expect(entry).toMatchObject({
            configDir: accountDir,
            noPersistence: true,
            judgePrompt: true,
          });
        }
        expect(seen[0].pid).not.toBe(seen[1].pid);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("starts a process for an enabled account, so its first question is answered", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-effort-judge-test-" });
      const accountDir = path.join(dir, "account-dung");
      yield* fs.makeDirectory(accountDir);
      const binary = writeFakeCli({ directory: dir, name: "claude", source: FAKE_JUDGE });
      const judgeStarted = yield* fs.watch(accountDir).pipe(
        Stream.filter((event) => event.path.endsWith("judge-starts")),
        Stream.runHead,
        Effect.forkScoped,
      );
      const judge = yield* makeClaudeEffortJudge(
        decodeClaudeSettings({ binaryPath: binary, homePath: accountDir }),
      );

      yield* Fiber.join(judgeStarted).pipe(Effect.timeout("10 seconds"));
      const reply = yield* judge.ask("rename x");

      expect(JSON.parse(Option.getOrThrow(reply))).toMatchObject({ question: "rename x" });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("waits for the first question before starting a pool that is not warmed at start", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-effort-judge-test-" });
      const accountDir = path.join(dir, "account-hieu");
      yield* fs.makeDirectory(accountDir);
      const binary = writeFakeCli({ directory: dir, name: "claude", source: FAKE_JUDGE });
      const suggester = yield* makeClaudeEffortJudge(
        decodeClaudeSettings({ binaryPath: binary, homePath: accountDir }),
        undefined,
        { systemPrompt: "Predict the next prompt.", warmAtStart: false },
      );

      expect(yield* fs.exists(path.join(accountDir, "judge-starts"))).toBe(false);
      expect(Option.isNone(yield* suggester.ask("cold"))).toBe(true);
      yield* suggester.prewarm;
      const reply = yield* suggester.ask("run the tests?");

      expect(JSON.parse(Option.getOrThrow(reply))).toMatchObject({
        question: "run the tests?",
        systemPrompt: "Predict the next prompt.",
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("answers a cold question by starting a process for it when asked to wait", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-effort-judge-test-" });
      const accountDir = path.join(dir, "account-thanh");
      yield* fs.makeDirectory(accountDir);
      const binary = writeFakeCli({ directory: dir, name: "claude", source: FAKE_JUDGE });
      const recapper = yield* makeClaudeEffortJudge(
        decodeClaudeSettings({ binaryPath: binary, homePath: accountDir }),
        undefined,
        { systemPrompt: "Recap the turn.", warmAtStart: false, waitWhenCold: true },
      );

      const reply = yield* recapper.ask("what changed?");

      expect(JSON.parse(Option.getOrThrow(reply))).toMatchObject({
        question: "what changed?",
        systemPrompt: "Recap the turn.",
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("answers two questions at once from a pool of two", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-effort-judge-test-" });
      const accountDir = path.join(dir, "account-pool");
      yield* fs.makeDirectory(accountDir);
      const binary = writeFakeCli({ directory: dir, name: "claude", source: FAKE_JUDGE });
      const judge = yield* makeClaudeEffortJudge(
        decodeClaudeSettings({ binaryPath: binary, homePath: accountDir, enabled: false }),
        undefined,
        { poolSize: 2 },
      );

      yield* judge.prewarm;
      yield* judge.prewarm;
      const replies = yield* Effect.all([judge.ask("rename x"), judge.ask("migrate everything")], {
        concurrency: 2,
      });
      const seen = replies.map((reply) => JSON.parse(Option.getOrThrow(reply)));

      expect(seen.map((entry) => entry.question).toSorted()).toEqual([
        "migrate everything",
        "rename x",
      ]);
      expect(seen[0].pid).not.toBe(seen[1].pid);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("replaces a process that waited past the idle limit", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-effort-judge-test-" });
      const accountDir = path.join(dir, "account-idle");
      yield* fs.makeDirectory(accountDir);
      const binary = writeFakeCli({ directory: dir, name: "claude", source: FAKE_JUDGE });
      const startsFile = path.join(accountDir, "judge-starts");
      const secondStart = yield* fs.watch(accountDir).pipe(
        Stream.mapEffect(() => fs.readFileString(startsFile).pipe(Effect.orElseSucceed(() => ""))),
        Stream.map((text) => text.split("\n").filter((line) => line !== "")),
        Stream.filter((pids) => pids.length >= 2),
        Stream.runHead,
        Effect.forkScoped,
      );
      const judge = yield* makeClaudeEffortJudge(
        decodeClaudeSettings({ binaryPath: binary, homePath: accountDir }),
        undefined,
        { maxIdle: "200 millis" },
      );

      const pids = Option.getOrThrow(
        yield* Fiber.join(secondStart).pipe(Effect.timeout("10 seconds")),
      );
      const reply = yield* judge.ask("rename x");

      expect(JSON.parse(Option.getOrThrow(reply)).pid).not.toBe(Number(pids[0]));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("lets go of an interrupted question without waiting for its process to exit", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-effort-judge-test-" });
      const accountDir = path.join(dir, "account-stubborn");
      yield* fs.makeDirectory(accountDir);
      const binary = writeFakeCli({ directory: dir, name: "claude", source: STUBBORN_JUDGE });
      const asked = yield* fs.watch(accountDir).pipe(
        Stream.filter((event) => event.path.endsWith("judge-asked")),
        Stream.runHead,
        Effect.forkScoped,
      );
      const judge = yield* makeClaudeEffortJudge(
        decodeClaudeSettings({ binaryPath: binary, homePath: accountDir, enabled: false }),
      );

      yield* judge.prewarm;
      const question = yield* judge.ask("anything").pipe(Effect.forkChild);
      yield* Fiber.join(asked).pipe(Effect.timeout("10 seconds"));

      yield* Fiber.interrupt(question).pipe(Effect.timeout("500 millis"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("reports no answer when the judge cannot start", () =>
    Effect.gen(function* () {
      const judge = yield* makeClaudeEffortJudge(
        decodeClaudeSettings({ binaryPath: "/nonexistent/claude-judge" }),
      );
      expect(Option.isNone(yield* judge.ask("anything"))).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
