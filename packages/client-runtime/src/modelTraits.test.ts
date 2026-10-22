import { ProviderDriverKind, type ProviderOptionDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildTraitsTriggerDisplay } from "./modelTraits.ts";

const descriptors = (autoEffort: boolean): ReadonlyArray<ProviderOptionDescriptor> => [
  {
    id: "effort",
    label: "Effort",
    type: "select",
    options: [
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
    ],
    currentValue: "high",
  },
  { id: "autoEffort", label: "Auto effort", type: "boolean", currentValue: autoEffort },
];

const label = (autoEffort: boolean) =>
  buildTraitsTriggerDisplay({
    provider: ProviderDriverKind.make("claudeAgent"),
    descriptors: descriptors(autoEffort),
    primarySelectDescriptorId: "effort",
    ultrathinkPromptControlled: false,
  }).label;

describe("buildTraitsTriggerDisplay", () => {
  it("marks the effort as the Auto fallback only while Auto effort is on", () => {
    expect(label(true)).toBe("Auto · High");
    expect(label(false)).toBe("High");
  });
});
