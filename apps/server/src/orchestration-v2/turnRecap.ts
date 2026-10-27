import type { OrchestrationV2TurnItem, OrchestrationV2TurnRecap } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const USER_TEXT_CHARS = 600;
const ASSISTANT_TEXT_CHARS = 2_000;
const MAX_ACTIONS = 24;
const MAX_SUMMARY_CHARS = 420;
const MAX_QUESTION_CHARS = 140;
const MAX_REPLY_CHARS = 60;

export const RECAP_SYSTEM = `You write the recap a user reads when their coding agent's turn ends.
Read the user's request, what the agent did, and the end of its reply. Answer with one JSON object and nothing else:
{"summary": "...", "question": "...", "replies": ["...", "..."]}

- summary: 2 or 3 short sentences, at most 300 characters. First what is now true or changed, then what is not done or not verified. Concrete, no praise, in the user's language.
- question: only when the next move is the user's call (a choice, an approval, a go-ahead), one short question of at most 100 characters. Leave it out otherwise, and leave it out when the agent already asked the user on a card.
- replies: with a question, 1 or 2 replies of at most 4 words each, written as the user's own answer, the agent's recommendation first. Without a question, an empty array.`;

const RECAP_WORK_TYPES = new Set<OrchestrationV2TurnItem["type"]>([
  "file_change",
  "command_execution",
  "proposed_plan",
]);

/** Item types whose card already asks the user, so the recap must not ask again. */
export const CARD_REQUEST_TYPES: ReadonlyArray<OrchestrationV2TurnItem["type"]> = [
  "proposed_plan",
  "child_plan_request",
  "secret_request",
  "link_request",
];

/** A run earns a recap once it edited files, ran commands or proposed a plan. */
export function isMultiStepRun(history: ReadonlyArray<OrchestrationV2TurnItem>): boolean {
  return history.some((item) => RECAP_WORK_TYPES.has(item.type));
}

function actionLine(item: OrchestrationV2TurnItem): string | undefined {
  switch (item.type) {
    case "command_execution": {
      const command = item.input.split("\n", 1)[0]!.slice(0, 120);
      const failed = item.outputIndicatesFailure === true || (item.exitCode ?? 0) !== 0;
      return `- ran \`${command}\`${failed ? " (failed)" : ""}`;
    }
    case "file_change":
      return `- edited ${item.fileName}`;
    case "proposed_plan":
      return "- proposed a plan on a card the user decides";
    default:
      return undefined;
  }
}

/** The question one recap is asked from. */
export function recapQuestion(history: ReadonlyArray<OrchestrationV2TurnItem>): string | undefined {
  const lastText = (type: "user_message" | "assistant_message") =>
    history.findLast(
      (item): item is Extract<OrchestrationV2TurnItem, { type: typeof type }> =>
        item.type === type && item.text.trim() !== "",
    )?.text;
  const userText = lastText("user_message");
  const assistantText = lastText("assistant_message");
  if (userText === undefined || assistantText === undefined) return undefined;
  const actions = [...new Set(history.flatMap((item) => actionLine(item) ?? []))];
  return [
    "User's request:",
    userText.slice(0, USER_TEXT_CHARS),
    "",
    "What the agent did:",
    ...actions.slice(-MAX_ACTIONS),
    "",
    "Agent's reply (end):",
    assistantText.slice(-ASSISTANT_TEXT_CHARS),
  ].join("\n");
}

const RecapReply = Schema.Struct({
  summary: Schema.String,
  question: Schema.optional(Schema.NullOr(Schema.String)),
  replies: Schema.optional(Schema.Array(Schema.String)),
});
const decodeRecapReply = Schema.decodeUnknownOption(Schema.fromJsonString(RecapReply));

/** The recap the card shows, or undefined when the reply holds no usable one. */
export function parseRecap(reply: string): OrchestrationV2TurnRecap | undefined {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end < start) return undefined;
  const decoded = decodeRecapReply(reply.slice(start, end + 1));
  if (Option.isNone(decoded)) return undefined;
  const summary = decoded.value.summary.trim();
  if (summary === "" || summary.length > MAX_SUMMARY_CHARS) return undefined;
  const question = decoded.value.question?.trim() ?? "";
  const replies = [
    ...new Set(
      (decoded.value.replies ?? [])
        .map((text) => text.trim())
        .filter((text) => text !== "" && text.length <= MAX_REPLY_CHARS),
    ),
  ].slice(0, 2);
  return question === "" || question.length > MAX_QUESTION_CHARS || replies.length === 0
    ? { summary, replies: [] }
    : { summary, question, replies };
}
