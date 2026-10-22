import type { ModelSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { PromptSuggester } from "../orchestration-v2/PromptSuggestionHub.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";

const CLAUDE_DRIVER = "claudeAgent";

/** Asks Haiku on the text-generation Claude account, or the first enabled one. */
export const layer = Layer.effect(
  PromptSuggester,
  Effect.gen(function* () {
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

    return PromptSuggester.of({
      suggest: Effect.fn("PromptSuggester.suggest")(function* (question) {
        const instanceId = yield* suggesterInstanceId;
        if (instanceId === undefined) return Option.none<string>();
        const instance = yield* instanceRegistry.getInstance(instanceId);
        if (instance?.suggestNextPrompt === undefined) return Option.none<string>();
        return yield* instance.suggestNextPrompt(question);
      }),
    });
  }),
);
