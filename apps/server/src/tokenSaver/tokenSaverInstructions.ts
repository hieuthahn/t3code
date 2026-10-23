import {
  isTokenSaverConfigActive,
  type TokenSaverConciseLevel,
  type TokenSaverConfig,
  type TokenSaverSettings,
} from "@t3tools/contracts";

const HEADING =
  "## Token Saver\nThe user turned on these response-style rules to spend fewer tokens. Follow them unless the user asks otherwise in a message.";

const FIXED_EXCEPTION =
  "Always write plain, complete sentences for security warnings, irreversible or destructive actions, ordered steps the user must follow, questions you ask the user, and any text you write into files, commit messages, pull requests or documentation. These rules shape your chat replies only.";

const CONCISE_RULES: Record<Exclude<TokenSaverConciseLevel, "off">, ReadonlyArray<string>> = {
  lite: [
    "Put the answer first.",
    "Skip preambles, restating the request and closing recaps.",
    "Use short, normal sentences.",
    "Keep every technical detail exact: names, paths, numbers, commands and error text.",
  ],
  full: [
    "Put the answer first and stop when it is complete.",
    "Skip preambles, restating the request, recaps, hedges and pleasantries.",
    "Prefer short lists and sentence fragments to paragraphs, one point per line.",
    "Report outcomes, not the steps that produced them.",
    "Keep every technical detail exact: names, paths, numbers, commands and error text.",
  ],
  ultra: [
    "Reply with the fewest words that still carry the answer.",
    "Use terse fragments, arrows and common abbreviations where the meaning stays clear.",
    "No transitions, no recaps, no explanations unless asked.",
    "Keep every technical detail exact: names, paths, numbers, commands and error text.",
  ],
};

const LEAN_CODE_RULES: ReadonlyArray<string> = [
  "Write the least code that correctly does the task.",
  "Reuse existing functions, components and patterns before adding new ones.",
  "Add no speculative options, abstractions, configuration or handling for cases that cannot happen.",
  "Leave code the task does not touch as it is.",
];

const QUIET_TOOLS_RULES: ReadonlyArray<string> = [
  "Search with targeted patterns and paths instead of broad listings.",
  "Read only the line ranges you need.",
  "Do not re-read a file whose current contents are already in context.",
  "Prefer one well-aimed command to several exploratory ones, and keep command output short.",
];

const section = (title: string, rules: ReadonlyArray<string>) =>
  [`### ${title}`, ...rules.map((rule) => `- ${rule}`)].join("\n");

/** The config a turn runs with: nothing while the master switch is off, else the thread's own or the defaults. */
export function effectiveTokenSaverConfig(
  settings: TokenSaverSettings,
  threadOverride: TokenSaverConfig | undefined,
): TokenSaverConfig | undefined {
  if (!settings.enabled) return undefined;
  const config = threadOverride ?? settings.defaults;
  return isTokenSaverConfigActive(config) ? config : undefined;
}

/** A stable label for a config, used to detect changes and to tag measured turns. */
export function tokenSaverProfileKey(config: TokenSaverConfig | undefined): string {
  if (config === undefined || !isTokenSaverConfigActive(config)) return "off";
  return [
    ...(config.concise === "off" ? [] : [`concise-${config.concise}`]),
    ...(config.leanCode ? ["lean-code"] : []),
    ...(config.quietTools ? ["quiet-tools"] : []),
  ].join("+");
}

export function buildTokenSaverInstructions(
  config: TokenSaverConfig | undefined,
): string | undefined {
  if (config === undefined || !isTokenSaverConfigActive(config)) return undefined;
  return [
    HEADING,
    ...(config.concise === "off"
      ? []
      : [section("Concise replies", CONCISE_RULES[config.concise])]),
    ...(config.leanCode ? [section("Lean code", LEAN_CODE_RULES)] : []),
    ...(config.quietTools ? [section("Quiet tools", QUIET_TOOLS_RULES)] : []),
    `### Exception\n${FIXED_EXCEPTION}`,
  ].join("\n\n");
}
