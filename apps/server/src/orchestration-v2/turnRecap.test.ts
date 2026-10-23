import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isMultiStepRun, parseRecap, recapQuestion } from "./turnRecap.ts";

const items = (...list: ReadonlyArray<object>) =>
  list as unknown as ReadonlyArray<OrchestrationV2TurnItem>;

const chat = items(
  { type: "user_message", text: "what does this function do?" },
  { type: "assistant_message", text: "It parses the config." },
);

describe("isMultiStepRun", () => {
  it("skips a run that only talked", () => {
    expect(isMultiStepRun(chat)).toBe(false);
  });

  it.each(["file_change", "command_execution", "proposed_plan"])("counts a run with %s", (type) => {
    expect(isMultiStepRun(items(...chat, { type }))).toBe(true);
  });
});

describe("recapQuestion", () => {
  it("lists what the run did between the request and the reply", () => {
    const question = recapQuestion(
      items(
        { type: "user_message", text: "fix the parser" },
        { type: "command_execution", input: "vp test run parser.test.ts\n--watch", exitCode: 1 },
        { type: "file_change", fileName: "src/parser.ts" },
        { type: "file_change", fileName: "src/parser.ts" },
        { type: "assistant_message", text: "Fixed. Tests not run again." },
      ),
    );
    expect(question).toBe(
      [
        "User's request:",
        "fix the parser",
        "",
        "What the agent did:",
        "- ran `vp test run parser.test.ts` (failed)",
        "- edited src/parser.ts",
        "",
        "Agent's reply (end):",
        "Fixed. Tests not run again.",
      ].join("\n"),
    );
  });

  it("asks nothing without a reply to recap", () => {
    expect(recapQuestion(items({ type: "user_message", text: "go" }))).toBeUndefined();
  });
});

describe("parseRecap", () => {
  it("keeps the summary, question and replies", () => {
    expect(
      parseRecap(
        '```json\n{"summary": "Parser fixed. Tests not run.", "question": "Run the tests?", "replies": ["Yes, run them", "Not now", "Later"]}\n```',
      ),
    ).toEqual({
      summary: "Parser fixed. Tests not run.",
      question: "Run the tests?",
      replies: ["Yes, run them", "Not now"],
    });
  });

  it("keeps one button per distinct reply", () => {
    expect(
      parseRecap('{"summary": "Done.", "question": "Ship it?", "replies": ["Yes", " Yes ", "No"]}'),
    ).toEqual({ summary: "Done.", question: "Ship it?", replies: ["Yes", "No"] });
  });

  it("drops a question that has no reply buttons", () => {
    expect(parseRecap('{"summary": "Done.", "question": "Ship it?", "replies": []}')).toEqual({
      summary: "Done.",
      replies: [],
    });
  });

  it.each([
    ["not json at all"],
    ['{"summary": ""}'],
    ['{"question": "Ship it?"}'],
    [`{"summary": "${"x".repeat(500)}"}`],
  ])("rejects %j", (reply) => {
    expect(parseRecap(reply)).toBeUndefined();
  });
});
