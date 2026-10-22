import { describe, expect, it } from "vite-plus/test";

import { modelRowClickIntent, multipleModelsTriggerLabel } from "./modelPickerMultiple";

describe("multipleModelsTriggerLabel", () => {
  it("counts several models instead of listing them", () => {
    expect(multipleModelsTriggerLabel(["Claude Opus 5.5", "Claude Sonnet 5.5"])).toBe("2 models");
    expect(multipleModelsTriggerLabel(["A", "B", "C", "D"])).toBe("4 models");
  });

  it("names a single model and asks for one when none is chosen", () => {
    expect(multipleModelsTriggerLabel(["GPT-6-Luna"])).toBe("GPT-6-Luna");
    expect(multipleModelsTriggerLabel([])).toBe("Choose models");
  });
});

describe("modelRowClickIntent", () => {
  it("adds on a plain click once the mode is on", () => {
    expect(
      modelRowClickIntent({ shiftKey: false, multiSelectMode: true, canToggle: true }),
    ).toEqual({ additive: true, entersMode: false });
  });

  it("turns the mode on from a Shift-click", () => {
    expect(
      modelRowClickIntent({ shiftKey: true, multiSelectMode: false, canToggle: true }),
    ).toEqual({ additive: true, entersMode: true });
  });

  it("replaces the model on a plain click in single mode", () => {
    expect(
      modelRowClickIntent({ shiftKey: false, multiSelectMode: false, canToggle: true }),
    ).toEqual({ additive: false, entersMode: false });
  });

  it("never adds where the picker takes one model", () => {
    expect(
      modelRowClickIntent({ shiftKey: true, multiSelectMode: true, canToggle: false }),
    ).toEqual({ additive: false, entersMode: false });
  });
});
