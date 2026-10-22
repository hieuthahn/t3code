import { describe, expect, it } from "vite-plus/test";

import { promptSuggestionKeyAction, visiblePromptSuggestion } from "./promptSuggestion";

const shown = {
  suggestion: "run the tests",
  enabled: true,
  phase: "ready" as const,
  prompt: "",
  dismissed: null,
  placeholderTaken: false,
};

const plainKey = {
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  isComposing: false,
  keyCode: 0,
};

describe("visiblePromptSuggestion", () => {
  it("shows the suggestion on an idle, empty composer", () => {
    expect(visiblePromptSuggestion(shown)).toBe("run the tests");
  });

  it.each([
    ["the setting is off", { enabled: false }],
    ["the thread is running", { phase: "running" as const }],
    ["the thread is connecting", { phase: "connecting" as const }],
    ["the user started typing", { prompt: "r" }],
    ["the user dismissed it", { dismissed: "run the tests" }],
    ["an approval owns the composer", { placeholderTaken: true }],
    ["there is no suggestion", { suggestion: null }],
  ])("hides it when %s", (_reason, change) => {
    expect(visiblePromptSuggestion({ ...shown, ...change })).toBeNull();
  });

  it("shows a newer suggestion after an older one was dismissed", () => {
    expect(visiblePromptSuggestion({ ...shown, dismissed: "commit this" })).toBe("run the tests");
  });
});

describe("promptSuggestionKeyAction", () => {
  const action = (key: string, change: Partial<typeof plainKey> = {}, menuIsActive = false) =>
    promptSuggestionKeyAction({
      key,
      event: { ...plainKey, ...change },
      suggestion: "run the tests",
      menuIsActive,
    });

  it("accepts on Tab and dismisses on Escape", () => {
    expect(action("Tab")).toBe("accept");
    expect(action("Escape")).toBe("dismiss");
  });

  it("leaves Shift+Tab to plan mode and modified keys to their shortcuts", () => {
    expect(action("Tab", { shiftKey: true })).toBeNull();
    expect(action("Tab", { metaKey: true })).toBeNull();
    expect(action("Escape", { ctrlKey: true })).toBeNull();
  });

  it("leaves Tab to an open menu and to an IME composition", () => {
    expect(action("Tab", {}, true)).toBeNull();
    expect(action("Tab", { isComposing: true })).toBeNull();
    expect(action("Tab", { keyCode: 229 })).toBeNull();
  });

  it("ignores keys when nothing is suggested", () => {
    expect(
      promptSuggestionKeyAction({
        key: "Tab",
        event: plainKey,
        suggestion: null,
        menuIsActive: false,
      }),
    ).toBeNull();
  });
});
