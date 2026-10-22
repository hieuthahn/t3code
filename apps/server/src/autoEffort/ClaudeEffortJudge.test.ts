import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ClaudeSettings } from "@t3tools/contracts";
import { writeFakeCli } from "@t3tools/provider-testing/fakeCli";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { describe, expect } from "vite-plus/test";

import { assistantText, makeClaudeEffortJudge } from "./ClaudeEffortJudge.ts";

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

// Answers each stream-json question with what the judge process saw, then waits like claude -p.
const FAKE_JUDGE = `
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
createInterface({ input: process.stdin }).on("line", (line) => {
  const question = JSON.parse(line).message.content;
  const seen = {
    question,
    configDir: process.env.CLAUDE_CONFIG_DIR,
    pid: process.pid,
    noPersistence: args.includes("--no-session-persistence"),
    judgePrompt: args[args.indexOf("--system-prompt") + 1]?.startsWith("You choose the reasoning effort"),
  };
  process.stdout.write(JSON.stringify({ type: "system", subtype: "init" }) + "\\n");
  process.stdout.write(
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: JSON.stringify(seen) }] } }) + "\\n",
  );
});
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
          decodeClaudeSettings({ binaryPath: binary, homePath: accountDir }),
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

  it.live("reports no answer when the judge cannot start", () =>
    Effect.gen(function* () {
      const judge = yield* makeClaudeEffortJudge(
        decodeClaudeSettings({ binaryPath: "/nonexistent/claude-judge" }),
      );
      expect(Option.isNone(yield* judge.ask("anything"))).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
