/** Longest suggestion the composer shows; a longer reply is a paragraph, not a prompt. */
export const MAX_SUGGESTION_CHARS = 160;
const USER_TEXT_CHARS = 600;
const ASSISTANT_TEXT_CHARS = 2_000;

export const SUGGESTION_SYSTEM = `You predict the next message a user will type to their coding agent.
Read their last message and the agent's reply, then answer with what they would most likely type next.

Rules:
- Predict their words, not your advice. The test is whether they would think "I was about to type that".
- When the agent offers options, write out the one the user would choose in words, never its number. When it asks to continue, answer "yes" or "go ahead".
- Be specific ("run the tests" beats "continue"), 2 to 12 words, in the user's language and style.
- Never suggest praise or thanks, questions, the agent's own voice, new ideas, or more than one sentence.
- Reply with nothing at all when the next step is not obvious, after an error, or on sensitive topics.

Reply with only the suggestion, no quotes or explanation.`;

/** The question one suggestion is asked from. */
export function suggestionQuestion(input: {
  readonly userText: string;
  readonly assistantText: string;
}): string {
  return [
    "User's last message:",
    input.userText.slice(0, USER_TEXT_CHARS),
    "",
    "Agent's reply (end):",
    input.assistantText.slice(-ASSISTANT_TEXT_CHARS),
  ].join("\n");
}

const WRAPPER_TAG = /^<(suggestion|response|output|answer)>([\s\S]*)<\/\1>$/i;
const LABEL_PREFIX = /^\s*(suggested\s+(prompt|reply|input)|suggestion|reply|answer)\s*[:：]\s*/i;
const NO_SUGGESTION = /^(none|nothing|n\/a|no suggestion|\(none\)|done)\.?$/i;
/** One-word replies that still read as a whole prompt; Claude Code keeps the same short list. */
const ONE_WORD_PROMPTS = new Set([
  "yes",
  "ok",
  "okay",
  "sure",
  "continue",
  "commit",
  "push",
  "stop",
]);

/** The text the composer shows, or undefined when the reply holds no usable prompt. */
export function cleanSuggestion(reply: string): string | undefined {
  const text = reply
    .trim()
    .replace(WRAPPER_TAG, "$2")
    .replace(LABEL_PREFIX, "")
    .replace(/^["'`“”]+|["'`“”]+$/g, "")
    .trim();
  if (text === "" || text.includes("\n") || text.length > MAX_SUGGESTION_CHARS) return undefined;
  if (NO_SUGGESTION.test(text)) return undefined;
  const oneWord = !/\s/.test(text);
  return oneWord && !ONE_WORD_PROMPTS.has(text.toLowerCase().replace(/[.!]$/, ""))
    ? undefined
    : text;
}
