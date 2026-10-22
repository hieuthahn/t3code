import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderOptionSelections } from "./model.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/** "pinned" keeps a thread on the account the user picked; automatic switches leave it alone. */
export const ThreadAccountChoice = Schema.Literals(["auto", "pinned"]);
export type ThreadAccountChoice = typeof ThreadAccountChoice.Type;

const ModelSelectionWire = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ProviderOptionSelections),
  accountChoice: Schema.optionalKey(ThreadAccountChoice),
});

const ModelSelectionSource = Schema.Struct({
  provider: Schema.optional(Schema.Unknown),
  instanceId: Schema.optional(Schema.Unknown),
  model: Schema.Unknown,
  options: Schema.optional(Schema.Unknown),
  accountChoice: Schema.optional(Schema.Unknown),
});

export const ModelSelection = ModelSelectionSource.pipe(
  Schema.decodeTo(
    ModelSelectionWire,
    SchemaTransformation.transformEffect({
      decode: (raw) => {
        const instanceIdSource =
          raw.instanceId !== undefined
            ? raw.instanceId
            : typeof raw.provider === "string"
              ? raw.provider
              : undefined;
        const base: Record<string, unknown> = {
          instanceId: instanceIdSource,
          model: raw.model,
        };
        if (raw.options !== undefined) base.options = raw.options;
        if (raw.accountChoice !== undefined) base.accountChoice = raw.accountChoice;
        return Effect.succeed(base as typeof ModelSelectionWire.Encoded);
      },
      encode: (value) => {
        const base: Record<string, unknown> = {
          instanceId: value.instanceId,
          model: value.model,
        };
        if (value.options !== undefined) base.options = value.options;
        if (value.accountChoice !== undefined) base.accountChoice = value.accountChoice;
        return Effect.succeed(base as typeof ModelSelectionSource.Encoded);
      },
    }),
  ),
);
export type ModelSelection = typeof ModelSelection.Type;
