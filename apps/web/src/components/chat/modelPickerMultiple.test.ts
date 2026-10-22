import { describe, expect, it } from "vite-plus/test";

import { multipleModelsTriggerLabel } from "./modelPickerMultiple";

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
