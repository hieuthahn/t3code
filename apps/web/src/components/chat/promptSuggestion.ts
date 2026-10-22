import type { ChatComposerProps } from "./ChatComposer";

/** The suggestion the composer shows as ghost text, or null when it must stay hidden. */
export function visiblePromptSuggestion(input: {
  readonly suggestion: string | null;
  readonly enabled: boolean;
  readonly phase: ChatComposerProps["phase"];
  readonly prompt: string;
  readonly dismissed: string | null;
  /** Another placeholder (an approval, a question, a plan) owns the empty composer. */
  readonly placeholderTaken: boolean;
}): string | null {
  if (
    !input.enabled ||
    input.suggestion === null ||
    input.phase !== "ready" ||
    input.placeholderTaken ||
    input.prompt !== "" ||
    input.suggestion === input.dismissed
  ) {
    return null;
  }
  return input.suggestion;
}

/** Plain Tab or Escape on an empty composer that shows a suggestion. */
export function promptSuggestionKeyAction(input: {
  readonly key: string;
  readonly event: Pick<
    KeyboardEvent,
    "shiftKey" | "altKey" | "metaKey" | "ctrlKey" | "isComposing" | "keyCode"
  >;
  readonly suggestion: string | null;
  readonly menuIsActive: boolean;
}): "accept" | "dismiss" | null {
  const { key, event } = input;
  if (input.suggestion === null || input.menuIsActive) return null;
  if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return null;
  if (event.isComposing || event.keyCode === 229) return null;
  if (key === "Tab") return "accept";
  if (key === "Escape") return "dismiss";
  return null;
}
