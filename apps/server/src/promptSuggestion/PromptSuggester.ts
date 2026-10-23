import type { ModelSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { PromptSuggester } from "../orchestration-v2/PromptSuggestionHub.ts";
import { TurnRecapper } from "../orchestration-v2/TurnRecapHub.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";

const CLAUDE_DRIVER = "claudeAgent";

/** The text-generation Claude account, or the first enabled one. */
const quickClaudeInstance = Effect.gen(function* () {
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const instanceRegistry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const suggesterInstanceId = Effect.gen(function* () {
    const providers = yield* providerRegistry.getProviders;
    const textGeneration = yield* serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.textGenerationModelSelection.instanceId),
      Effect.orElseSucceed(() => undefined),
    );
    const claude = providers.filter(
      (provider) => provider.driver === CLAUDE_DRIVER && provider.enabled,
    );
    return (claude.find((provider) => provider.instanceId === textGeneration) ?? claude[0])
      ?.instanceId as ModelSelection["instanceId"] | undefined;
  });

  return Effect.gen(function* () {
    const instanceId = yield* suggesterInstanceId;
    return instanceId === undefined ? undefined : yield* instanceRegistry.getInstance(instanceId);
  });
});

/** Asks Haiku on the quick Claude account for the next prompt. */
export const layer = Layer.effect(
  PromptSuggester,
  Effect.gen(function* () {
    const instance = yield* quickClaudeInstance;
    return PromptSuggester.of({
      suggest: Effect.fn("PromptSuggester.suggest")(function* (question) {
        const current = yield* instance;
        if (current?.suggestNextPrompt === undefined) return Option.none<string>();
        return yield* current.suggestNextPrompt(question);
      }),
    });
  }),
);

/** Asks Haiku on the quick Claude account to recap a finished turn. */
export const layerTurnRecapper = Layer.effect(
  TurnRecapper,
  Effect.gen(function* () {
    const instance = yield* quickClaudeInstance;
    return TurnRecapper.of({
      recap: Effect.fn("TurnRecapper.recap")(function* (question) {
        const current = yield* instance;
        if (current?.recapTurn === undefined) return Option.none<string>();
        return yield* current.recapTurn(question);
      }),
    });
  }),
);
