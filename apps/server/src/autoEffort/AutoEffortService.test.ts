import { it } from "@effect/vitest";
import {
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect } from "vite-plus/test";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AutoEffort from "./AutoEffortService.ts";

const CLAUDE = ProviderInstanceId.make("claude-viet");
const CODEX = ProviderInstanceId.make("codex");

const effortDescriptor = (id: string, levels: ReadonlyArray<string>) => ({
  id,
  label: "Effort",
  type: "select" as const,
  options: levels.map((level) => ({ id: level, label: level })),
});

const provider = (
  instanceId: ProviderInstanceId,
  driver: string,
  optionId: string,
  levels: ReadonlyArray<string>,
): ServerProvider => ({
  instanceId,
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: "0.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-22T00:00:00.000Z",
  models: [
    {
      slug: "model",
      name: "model",
      isCustom: false,
      capabilities: { optionDescriptors: [effortDescriptor(optionId, levels)] },
    },
  ],
  slashCommands: [],
  skills: [],
});

const selection = (
  instanceId: ProviderInstanceId,
  optionId: string,
  autoEffort: boolean,
): ModelSelection => ({
  instanceId,
  model: "model",
  options: [
    { id: optionId, value: "medium" },
    { id: "autoEffort", value: autoEffort },
  ],
});

interface Harness {
  readonly haikuReply?: Effect.Effect<Option.Option<string>>;
  readonly jevBody?: unknown;
  readonly jevKeyFile?: string;
  readonly judge?: "auto" | "haiku";
  readonly autoEffortDefault?: boolean;
  readonly levels?: ReadonlyArray<string>;
}

const run = <A>(
  harness: Harness,
  body: (input: {
    readonly service: AutoEffort.AutoEffortServiceShape;
    readonly haikuQuestions: Ref.Ref<ReadonlyArray<{ instanceId: string; question: string }>>;
    readonly jevAuthorization: Ref.Ref<ReadonlyArray<string>>;
  }) => Effect.Effect<A>,
) =>
  Effect.gen(function* () {
    const haikuQuestions = yield* Ref.make<ReadonlyArray<{ instanceId: string; question: string }>>(
      [],
    );
    const jevAuthorization = yield* Ref.make<ReadonlyArray<string>>([]);
    const layer = AutoEffort.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(ProviderRegistry.ProviderRegistry)({
            getProviders: Effect.succeed([
              provider(
                CLAUDE,
                "claudeAgent",
                "effort",
                harness.levels ?? ["low", "medium", "high", "xhigh", "max"],
              ),
              provider(CODEX, "codex", "reasoningEffort", [
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
              ]),
            ]),
          }),
          Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
            getInstance: (instanceId) =>
              Effect.succeed({
                judgeEffort: (question: string) =>
                  Ref.update(haikuQuestions, (list) => [...list, { instanceId, question }]).pipe(
                    Effect.andThen(
                      harness.haikuReply ??
                        Effect.succeed(Option.some('{"effort":"high","sure":0.9,"why":"big job"}')),
                    ),
                  ),
              } as never),
          }),
          ServerSettings.layerTest({
            autoEffortJudge: harness.judge ?? "auto",
            autoEffortDefault: harness.autoEffortDefault ?? true,
          }),
          FileSystem.layerNoop({
            readFileString: () =>
              harness.jevKeyFile === undefined
                ? Effect.die("no key file")
                : Effect.succeed(harness.jevKeyFile),
          }),
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Ref.update(jevAuthorization, (list) => [
                ...list,
                request.headers.authorization ?? "",
              ]).pipe(
                Effect.as(
                  HttpClientResponse.fromWeb(request, Response.json(harness.jevBody ?? {})),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    const service = yield* AutoEffort.AutoEffortService.pipe(Effect.provide(layer));
    return yield* body({ service, haikuQuestions, jevAuthorization });
  });

const request = (
  overrides: Partial<AutoEffort.AutoEffortRequest> = {},
): AutoEffort.AutoEffortRequest => ({
  threadId: ThreadId.make("thread-1"),
  driver: ProviderDriverKind.make("claudeAgent"),
  modelSelection: selection(CLAUDE, "effort", true),
  text: "review the whole repo and fix what you find",
  attachmentCount: 0,
  previousUserText: undefined,
  previousAssistantText: undefined,
  ...overrides,
});

const effortOf = (resolution: AutoEffort.AutoEffortResolution, optionId = "effort") =>
  resolution.modelSelection.options?.find((option) => option.id === optionId)?.value;

describe("AutoEffortService", () => {
  it.effect("leaves the selection alone when Auto effort is off", () =>
    run({}, ({ service, haikuQuestions }) =>
      Effect.gen(function* () {
        const resolution = yield* service.resolve(
          request({ modelSelection: selection(CLAUDE, "effort", false) }),
        );
        expect(resolution).toEqual({
          modelSelection: selection(CLAUDE, "effort", false),
          notice: undefined,
        });
        expect(yield* Ref.get(haikuQuestions)).toEqual([]);
      }),
    ),
  );

  it.effect("judges a thread that never set the switch only while the default is on", () =>
    Effect.gen(function* () {
      const untouched: ModelSelection = {
        instanceId: CLAUDE,
        model: "model",
        options: [{ id: "effort", value: "medium" }],
      };
      yield* run({ judge: "haiku" }, ({ service }) =>
        Effect.gen(function* () {
          expect(effortOf(yield* service.resolve(request({ modelSelection: untouched })))).toBe(
            "high",
          );
        }),
      );
      yield* run({ judge: "haiku", autoEffortDefault: false }, ({ service, haikuQuestions }) =>
        Effect.gen(function* () {
          const resolution = yield* service.resolve(request({ modelSelection: untouched }));
          expect(resolution.notice).toBeUndefined();
          expect(yield* Ref.get(haikuQuestions)).toEqual([]);
        }),
      );
    }),
  );

  it.effect("asks Haiku on the thread's own Claude account and applies its verdict", () =>
    run({ judge: "haiku" }, ({ service, haikuQuestions }) =>
      Effect.gen(function* () {
        const resolution = yield* service.resolve(request());
        expect(effortOf(resolution)).toBe("high");
        expect(resolution.notice).toBe("Auto effort: high · by Haiku · big job");
        const asked = yield* Ref.get(haikuQuestions);
        expect(asked.map((entry) => entry.instanceId)).toEqual([CLAUDE]);
        expect(asked[0]?.question).toContain("Next message:\nreview the whole repo");
      }),
    ),
  );

  it.effect("judges a Codex thread through a Claude account and sets reasoningEffort", () =>
    run({ judge: "haiku" }, ({ service, haikuQuestions }) =>
      Effect.gen(function* () {
        const resolution = yield* service.resolve(
          request({
            driver: ProviderDriverKind.make("codex"),
            modelSelection: selection(CODEX, "reasoningEffort", true),
          }),
        );
        expect(effortOf(resolution, "reasoningEffort")).toBe("high");
        expect((yield* Ref.get(haikuQuestions)).map((entry) => entry.instanceId)).toEqual([CLAUDE]);
      }),
    ),
  );

  it.effect("steps a verdict down to the strongest level the model offers", () =>
    run(
      {
        judge: "haiku",
        levels: ["low", "medium"],
        haikuReply: Effect.succeed(Option.some('{"effort":"max"}')),
      },
      ({ service }) =>
        Effect.gen(function* () {
          expect(effortOf(yield* service.resolve(request()))).toBe("medium");
        }),
    ),
  );

  it.effect(
    "applies a named level and keeps the last verdict for a follow-up, without a judge",
    () =>
      run({ judge: "haiku" }, ({ service, haikuQuestions }) =>
        Effect.gen(function* () {
          const asked = yield* service.resolve(request({ text: "use max effort here" }));
          expect(effortOf(asked)).toBe("max");
          expect(asked.notice).toBe("Auto effort: max · as asked");
          const followUp = yield* service.resolve(
            request({ text: "ok", previousAssistantText: "Done, all tests pass." }),
          );
          expect(effortOf(followUp)).toBe("max");
          expect(followUp.notice).toBe("Auto effort: max · kept for a follow-up");
          expect(yield* Ref.get(haikuQuestions)).toEqual([]);
        }),
      ),
  );

  it.effect("starts on the manual effort when the judge misses the deadline", () =>
    run({ judge: "haiku", haikuReply: Effect.never }, ({ service }) =>
      Effect.gen(function* () {
        const fiber = yield* service.resolve(request()).pipe(Effect.forkChild);
        yield* TestClock.adjust("1500 millis");
        const resolution = yield* Fiber.join(fiber);
        expect(effortOf(resolution)).toBe("medium");
        expect(resolution.notice).toBe("Auto effort: medium (judge unavailable)");
      }),
    ),
  );

  it.effect("asks Jev first with the key from ~/.config/jev/.env", () =>
    run(
      {
        judge: "auto",
        jevKeyFile: "TYPESAFE_API_KEY=ts_test\n",
        jevBody: { answers: { effort: { choice: "low", confidence: 0.92 } } },
      },
      ({ service, haikuQuestions, jevAuthorization }) =>
        Effect.gen(function* () {
          const resolution = yield* service.resolve(request({ text: "what does this flag do?" }));
          expect(effortOf(resolution)).toBe("low");
          expect(resolution.notice).toBe("Auto effort: low · by Jev · 92% sure");
          expect(yield* Ref.get(jevAuthorization)).toEqual(["Bearer ts_test"]);
          expect(yield* Ref.get(haikuQuestions)).toEqual([]);
        }),
    ),
  );

  it.effect("lets Haiku decide when Jev is unsure, and skips Jev when the judge is haiku", () =>
    Effect.gen(function* () {
      const unsure = {
        jevKeyFile: "TYPESAFE_API_KEY=ts_test\n",
        jevBody: { answers: { effort: { choice: "low", confidence: 0.3 } } },
      };
      yield* run({ ...unsure, judge: "auto" }, ({ service }) =>
        Effect.gen(function* () {
          expect(effortOf(yield* service.resolve(request()))).toBe("high");
        }),
      );
      yield* run({ ...unsure, judge: "haiku" }, ({ service, jevAuthorization }) =>
        Effect.gen(function* () {
          yield* service.resolve(request());
          expect(yield* Ref.get(jevAuthorization)).toEqual([]);
        }),
      );
    }),
  );
});
