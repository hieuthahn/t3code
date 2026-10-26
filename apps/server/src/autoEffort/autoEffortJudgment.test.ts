import {
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  AUTO_EFFORT_OPTION_ID,
  clampToSupported,
  isAutoEffortOn,
  isFollowUp,
  jevRequestBody,
  judgeQuestion,
  namedEffort,
  parseJevAnswer,
  parseJevKey,
  parseJudgeVerdict,
  supportedEffortLevels,
  withAutoEffortDescriptor,
} from "./autoEffortJudgment.ts";

const effortModel = (slug: string, optionId: string, levels: ReadonlyArray<string>) =>
  ({
    slug,
    name: slug,
    isCustom: false,
    capabilities: {
      optionDescriptors: [
        {
          id: optionId,
          label: "Effort",
          type: "select",
          options: levels.map((id) => ({ id, label: id })),
        },
      ],
    },
  }) as ServerProviderModel;

const provider = (driver: string, models: ReadonlyArray<ServerProviderModel>): ServerProvider => ({
  instanceId: ProviderInstanceId.make(driver),
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: "0.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-22T00:00:00.000Z",
  models,
  slashCommands: [],
  skills: [],
});

const input = {
  model: "claude-opus-5-5",
  currentEffort: "medium",
  text: "review the whole repo",
  attachmentCount: 0,
  previousUserText: "hello",
  previousAssistantText: "Hi, what should I look at?",
};

describe("withAutoEffortDescriptor", () => {
  it("offers the switch on Claude and Codex models that pick an effort", () => {
    const claude = withAutoEffortDescriptor(
      provider("claudeAgent", [effortModel("opus", "effort", ["low", "high"])]),
      true,
    );
    const codex = withAutoEffortDescriptor(
      provider("codex", [effortModel("luna", "reasoningEffort", ["low", "high"])]),
      true,
    );
    for (const decorated of [claude, codex]) {
      expect(
        decorated.models[0]?.capabilities?.optionDescriptors?.find(
          (descriptor) => descriptor.id === AUTO_EFFORT_OPTION_ID,
        ),
      ).toMatchObject({ type: "boolean", currentValue: true });
    }
  });

  it("leaves other drivers and effortless models alone, and does not add it twice", () => {
    const cursor = provider("cursor", [effortModel("composer", "effort", ["low"])]);
    expect(withAutoEffortDescriptor(cursor, true)).toBe(cursor);
    const haiku = provider("claudeAgent", [
      { ...effortModel("haiku", "effort", []), capabilities: {} },
    ]);
    expect(withAutoEffortDescriptor(haiku, true)).toBe(haiku);
    const once = withAutoEffortDescriptor(
      provider("claudeAgent", [effortModel("opus", "effort", ["low"])]),
      true,
    );
    expect(withAutoEffortDescriptor(once, true)).toBe(once);
  });
});

describe("the Auto effort default", () => {
  it("moves the switch's default when the setting changes, keeping one switch", () => {
    const on = withAutoEffortDescriptor(
      provider("claudeAgent", [effortModel("opus", "effort", ["low"])]),
      true,
    );
    const off = withAutoEffortDescriptor(on, false);
    const switches = off.models[0]?.capabilities?.optionDescriptors?.filter(
      (descriptor) => descriptor.id === AUTO_EFFORT_OPTION_ID,
    );
    expect(switches).toEqual([expect.objectContaining({ currentValue: false })]);
  });

  it("lets a thread's own switch win over the default", () => {
    const selection = (options: NonNullable<ModelSelection["options"]>): ModelSelection => ({
      instanceId: ProviderInstanceId.make("claude"),
      model: "opus",
      options,
    });
    expect(isAutoEffortOn(selection([{ id: "effort", value: "high" }]), true)).toBe(true);
    expect(isAutoEffortOn(selection([{ id: "effort", value: "high" }]), false)).toBe(false);
    expect(isAutoEffortOn(selection([{ id: AUTO_EFFORT_OPTION_ID, value: false }]), true)).toBe(
      false,
    );
  });
});

describe("clampToSupported", () => {
  it("keeps an offered level and steps down to the strongest offered one", () => {
    expect(clampToSupported("high", ["low", "medium", "high"])).toBe("high");
    expect(clampToSupported("max", ["low", "medium", "high"])).toBe("high");
    expect(clampToSupported("xhigh", ["low", "max"])).toBe("low");
  });

  it("steps up when nothing is offered below the verdict", () => {
    expect(clampToSupported("low", ["medium", "high"])).toBe("medium");
    expect(clampToSupported("low", [])).toBeUndefined();
  });

  it("reads the offered levels from the model's descriptor", () => {
    const codex = provider("codex", [
      effortModel("luna", "reasoningEffort", ["low", "max", "ultra"]),
    ]);
    expect(supportedEffortLevels(codex, "luna")).toEqual(["low", "max"]);
  });
});

describe("shortcuts", () => {
  it("applies a level the message names, unless it is negated", () => {
    expect(namedEffort("fix this, high effort please")).toBe("high");
    expect(namedEffort("effort: low, just rename it")).toBe("low");
    expect(namedEffort("go xhigh on this one")).toBe("xhigh");
    expect(namedEffort("no max effort needed, quick fix")).toBeUndefined();
    expect(namedEffort("make the font bigger")).toBeUndefined();
  });

  it("treats a short reply as a follow-up only when the last reply asked nothing", () => {
    expect(isFollowUp("ok", "Done, the tests pass.")).toBe(true);
    expect(isFollowUp("yes", "Should I build the importer?")).toBe(false);
    expect(isFollowUp("please continue with it", "Done.")).toBe(false);
  });
});

describe("judge prompts", () => {
  it("asks Haiku with the current pair, recent conversation and the next message", () => {
    const question = judgeQuestion({ ...input, attachmentCount: 2 });
    expect(question).toContain("Current: claude-opus-5-5 / medium");
    expect(question).toContain("user: hello\nassistant: Hi, what should I look at?");
    expect(question).toContain("Next message:\nreview the whole repo");
    expect(question).toContain("[The message comes with 2 attachments to look at.]");
  });

  it("sends Jev the same state and only an effort question", () => {
    const body = JSON.parse(jevRequestBody(input));
    expect(body.state).toMatchObject({
      current_model: "claude-opus-5-5",
      current_effort: "medium",
      next_message: "review the whole repo",
    });
    expect(Object.keys(body.questions)).toEqual(["effort"]);
  });
});

describe("parsing", () => {
  it("reads Haiku's JSON even when it is wrapped in prose", () => {
    expect(parseJudgeVerdict('Sure: {"effort":"high","sure":0.8,"why":"big refactor"}')).toEqual({
      effort: "high",
      sure: 0.8,
      why: "big refactor",
    });
    expect(parseJudgeVerdict('{"effort":"ultra"}')).toBeUndefined();
    expect(parseJudgeVerdict("no json")).toBeUndefined();
  });

  it("takes Jev's choice with its confidence, an unsure one included", () => {
    expect(parseJevAnswer({ answers: { effort: { choice: "low", confidence: 0.9 } } })).toEqual({
      effort: "low",
      sure: 0.9,
      why: "90% sure",
    });
    expect(
      parseJevAnswer({
        result: { answers: { effort: { choice: "max", probabilities: { max: 0.3 } } } },
      }),
    ).toEqual({ effort: "max", sure: 0.3, why: "30% sure" });
    expect(parseJevAnswer({ answers: { effort: { choice: "huge" } } })).toBeUndefined();
  });

  it("reads the key line from a jev .env file", () => {
    expect(parseJevKey('OTHER=1\nTYPESAFE_API_KEY="ts_abc"\n')).toBe("ts_abc");
    expect(parseJevKey("TYPESAFE_API_KEY=\n")).toBeUndefined();
  });
});
