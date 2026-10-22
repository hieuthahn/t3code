import { describe, expect, it } from "vite-plus/test";

import { cleanSuggestion, MAX_SUGGESTION_CHARS, suggestionQuestion } from "./promptSuggestion.ts";

describe("cleanSuggestion", () => {
  it.each([
    ["run the tests", "run the tests"],
    ["  write tests for sum \n", "write tests for sum"],
    ['"commit this"', "commit this"],
    ["<suggestion>push it</suggestion>", "push it"],
    ["Suggestion: go ahead", "go ahead"],
  ])("keeps %j as %j", (reply, expected) => {
    expect(cleanSuggestion(reply)).toBe(expected);
  });

  it.each(["", "   ", "none", "Nothing.", "done", "first line\nsecond line"])(
    "drops %j",
    (reply) => {
      expect(cleanSuggestion(reply)).toBeUndefined();
    },
  );

  it("drops a reply longer than a prompt", () => {
    expect(cleanSuggestion("a".repeat(MAX_SUGGESTION_CHARS + 1))).toBeUndefined();
  });
});

describe("suggestionQuestion", () => {
  it("keeps the start of the user's message and the end of the reply", () => {
    const question = suggestionQuestion({
      userText: `fix it${"u".repeat(1_000)}`,
      assistantText: `${"a".repeat(3_000)}Want me to run the tests?`,
    });
    expect(question).toContain("fix it");
    expect(question).toContain("Want me to run the tests?");
    expect(question.length).toBeLessThan(2_700);
  });
});
