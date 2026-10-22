import type {
  ModelSelection,
  ProviderDriverKind,
  ProviderOptionDescriptor,
  ServerProvider,
} from "@t3tools/contracts";
import { getModelSelectionBooleanOptionValue } from "@t3tools/shared/model";

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const AUTO_EFFORT_OPTION_ID = "autoEffort";

export interface EffortVerdict {
  readonly effort: EffortLevel;
  readonly sure?: number | undefined;
  readonly why?: string | undefined;
}

const isEffortLevel = (value: unknown): value is EffortLevel =>
  typeof value === "string" && (EFFORT_LEVELS as ReadonlyArray<string>).includes(value);

/** The select option each driver keeps its reasoning effort in. */
export function effortOptionId(driver: ProviderDriverKind): string | undefined {
  if (driver === "claudeAgent") return "effort";
  if (driver === "codex") return "reasoningEffort";
  return undefined;
}

export function isAutoEffortOn(selection: ModelSelection): boolean {
  return getModelSelectionBooleanOptionValue(selection, AUTO_EFFORT_OPTION_ID) === true;
}

/** Offers the Auto effort switch on every model whose driver judges effort per turn. */
export function withAutoEffortDescriptor(provider: ServerProvider): ServerProvider {
  const optionId = effortOptionId(provider.driver);
  if (optionId === undefined) return provider;
  let changed = false;
  const models = provider.models.map((model) => {
    const descriptors = model.capabilities?.optionDescriptors;
    if (
      descriptors === undefined ||
      !descriptors.some((descriptor) => descriptor.id === optionId) ||
      descriptors.some((descriptor) => descriptor.id === AUTO_EFFORT_OPTION_ID)
    ) {
      return model;
    }
    changed = true;
    const autoEffort: ProviderOptionDescriptor = {
      id: AUTO_EFFORT_OPTION_ID,
      label: "Auto effort",
      description: "Judge the effort for each message; the effort above is the fallback.",
      type: "boolean",
      currentValue: false,
    };
    return {
      ...model,
      capabilities: { ...model.capabilities, optionDescriptors: [...descriptors, autoEffort] },
    };
  });
  return changed ? { ...provider, models } : provider;
}

/** The effort levels a model's descriptor offers, in order of strength. */
export function supportedEffortLevels(
  provider: ServerProvider | undefined,
  model: string,
): ReadonlyArray<EffortLevel> {
  if (provider === undefined) return EFFORT_LEVELS;
  const optionId = effortOptionId(provider.driver);
  const descriptor = provider.models
    .find((candidate) => candidate.slug === model)
    ?.capabilities?.optionDescriptors?.find((candidate) => candidate.id === optionId);
  if (descriptor?.type !== "select") return EFFORT_LEVELS;
  const offered = new Set(descriptor.options.map((option) => option.id));
  return EFFORT_LEVELS.filter((level) => offered.has(level));
}

/** The strongest offered level not above the verdict, else the weakest one above it. */
export function clampToSupported(
  effort: EffortLevel,
  supported: ReadonlyArray<EffortLevel>,
): EffortLevel | undefined {
  const index = EFFORT_LEVELS.indexOf(effort);
  const below = supported.filter((level) => EFFORT_LEVELS.indexOf(level) <= index);
  return below.at(-1) ?? supported[0];
}

export function withEffort(
  selection: ModelSelection,
  optionId: string,
  effort: EffortLevel,
): ModelSelection {
  return {
    ...selection,
    options: [
      ...(selection.options ?? []).filter((option) => option.id !== optionId),
      { id: optionId, value: effort },
    ],
  };
}

const NAMED_LEVEL =
  /\b(?:(low|medium|high|xhigh|max)\s+effort|effort\s*[:=]?\s*(low|medium|high|xhigh|max))\b|\b(xhigh)\b/i;
const NEGATION = /\b(?:no|not|don't|dont|never|without|instead of)\b/i;

/** A level the message asks for in words, such as "high effort" or "effort: low". */
export function namedEffort(text: string): EffortLevel | undefined {
  const match = NAMED_LEVEL.exec(text);
  if (match === null) return undefined;
  const preceding = text.slice(Math.max(0, match.index - 20), match.index);
  if (NEGATION.test(preceding)) return undefined;
  const level = (match[1] ?? match[2] ?? match[3])?.toLowerCase();
  return isEffortLevel(level) ? level : undefined;
}

/** "ok", "go on", "yes": nothing new to judge unless the last reply asked a question. */
export function isFollowUp(text: string, previousAssistantText: string | undefined): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 12) return false;
  if (trimmed.split(/\s+/).length > 2) return false;
  return !(previousAssistantText ?? "").slice(-400).includes("?");
}

// Judge prompts adapted from the effortless Claude Code plugin (MIT, HeyCubit/effortless).
export const JUDGE_SYSTEM = `You choose the reasoning effort an agentic assistant (it reads files, runs tools and edits things, not only code) should use for the user's next message. Pick the cheapest effort that will still do the job well.

Effort: low for quick answers, medium for normal work, high for hard problems, xhigh or max only for very hard ones.

Effort is relative to the model in use ("Current" names it): a stronger model needs less effort for the same job. Opus at medium does about what Sonnet does at high, and Fable is stronger again.

Judge the SCOPE and the amount of work, not whether it is code. A short message can ask for a lot: "go through my whole drive and clean it up", "review the entire repo", "migrate everything" are big, multi-step, tool-heavy jobs where mistakes are costly: never low, usually high. Low is only for answers that need no tools and no planning.

If the message answers a question in the assistant's last reply (picks an option, says which one, confirms a plan), judge only the work that answer starts, as the reply describes it, not the length of the answer and not the work done before the question: "yes" or "no" to one small action is low, and picking a value for one setting is low. But picking which way to build something starts that build: judge the build. Approving a whole plan takes the effort of that plan. A plain "yes", "ok" or "do it" after "Should I build X?" approves building X: judge X, not the word.

A message that pushes back on, corrects or adds to a plan or claim under discussion continues that work: keep at least the effort that work had, never drop to low for it. Thanks, praise or a closing remark with no new request is low. A question about how to do something, or about effort itself, that needs no tools is low.

If the person asks for deep thought ("think hard", "ultrathink", "be thorough"), pick at least high; if they ask for a quick answer, pick low.

Reply with JSON only: {"effort":"low|medium|high|xhigh|max","sure":0.0-1.0 how sure you are,"why":"at most 6 words, in the user's language"}`;

export interface JudgeInput {
  readonly model: string;
  readonly currentEffort: string | undefined;
  readonly text: string;
  readonly attachmentCount: number;
  readonly previousUserText: string | undefined;
  readonly previousAssistantText: string | undefined;
}

function recentConversation(input: JudgeInput): string {
  return [
    input.previousUserText === undefined
      ? undefined
      : `user: ${input.previousUserText.slice(0, 400)}`,
    input.previousAssistantText === undefined
      ? undefined
      : `assistant: ${input.previousAssistantText.slice(-2000)}`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function nextMessage(input: JudgeInput, limit: number): string {
  const images =
    input.attachmentCount === 0
      ? ""
      : `\n\n[The message comes with ${input.attachmentCount} attachments to look at.]`;
  return `${input.text.slice(0, limit)}${images}`;
}

export function judgeQuestion(input: JudgeInput): string {
  const context = recentConversation(input);
  return [
    `Current: ${input.model} / ${input.currentEffort ?? "default"}`,
    context === "" ? undefined : `Recent conversation:\n${context}`,
    `Next message:\n${nextMessage(input, 2000)}`,
  ]
    .filter((part) => part !== undefined)
    .join("\n\n");
}

export function parseJudgeVerdict(text: string): EffortVerdict | undefined {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (json === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as Record<string, unknown>;
  if (!isEffortLevel(record.effort)) return undefined;
  const sure =
    typeof record.sure === "number" && record.sure >= 0 && record.sure <= 1
      ? record.sure
      : undefined;
  const why = typeof record.why === "string" ? record.why.slice(0, 60) : undefined;
  return { effort: record.effort, sure, why };
}

const JEV_TASK = `Choose the reasoning effort an agentic assistant should use for the next user message. It reads files, runs tools and edits things, not only code. Pick the cheapest that still does the job well. Judge the scope and the amount of work, not whether it is code: "go through my whole drive and clean it up" is a big tool-heavy job. Effort is relative to current_model: a stronger model needs less for the same job. A short follow-up ("yes", "go", "ok", in any language) keeps the current effort. When the message answers a question in the assistant's last reply, judge only the work that answer starts: yes/no to one small action is low; picking which way to build something starts that build, so judge the build; approving a whole plan takes the effort of that plan. Pushing back on or adding to a plan under discussion continues that work: keep its effort, never low. Thanks or a closing remark with no new request is low. A question about how to do something that needs no tools is low. "think hard", "ultrathink" or "be thorough" means at least high; "quick question" means low.`;

const JEV_EFFORTS = {
  low: "quick answer, no tools, no planning",
  medium: "normal work: a few tool calls or edits",
  high: "hard or large multi-step job: many tool calls, costly mistakes",
  xhigh: "very hard: a long investigation",
  max: "the hardest research-level work",
};

export function jevRequestBody(input: JudgeInput): string {
  return JSON.stringify({
    model: "jev-latest",
    state: {
      task: JEV_TASK,
      current_model: input.model,
      current_effort: input.currentEffort ?? "default",
      recent_conversation: recentConversation(input),
      next_message: nextMessage(input, 4000),
    },
    questions: {
      effort: {
        type: "choice",
        instructions: "Which effort fits the next message?",
        criteria: JEV_EFFORTS,
      },
    },
  });
}

/** Jev's choice, or undefined when it is unsure (below half) and Haiku should decide. */
export function parseJevAnswer(body: unknown): EffortVerdict | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, any>;
  const answers = record.answers ?? record.result?.answers;
  const choice = answers?.effort?.choice;
  if (!isEffortLevel(choice)) return undefined;
  const sure = answers.effort.confidence ?? answers.effort.probabilities?.[choice];
  if (typeof sure === "number" && sure < 0.5) return undefined;
  return {
    effort: choice,
    sure: typeof sure === "number" ? sure : undefined,
    why: typeof sure === "number" ? `${Math.round(sure * 100)}% sure` : undefined,
  };
}

const JEV_KEY_LINE = /^\s*TYPESAFE_API_KEY\s*=\s*(.*?)\s*$/m;

export function parseJevKey(envFile: string): string | undefined {
  const raw = JEV_KEY_LINE.exec(envFile)?.[1];
  const key = raw?.replace(/^(['"])(.*)\1$/, "$2").trim();
  return key === undefined || key === "" ? undefined : key;
}
