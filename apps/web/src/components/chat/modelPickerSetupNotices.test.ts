import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { modelPickerSetupSummary, resolveModelPickerSetupNotices } from "./modelPickerSetupNotices";

const entry = (id: string, status: string, installed = true) => ({
  instanceId: ProviderInstanceId.make(id),
  displayName: `Claude ${id}`,
  installed,
  snapshot: { auth: { status } },
});
const ENTRIES = [entry("hieu", "authenticated"), entry("viet", "unauthenticated")];
const needsSetup = (candidate: (typeof ENTRIES)[number]) =>
  candidate.snapshot.auth.status === "unauthenticated";

describe("resolveModelPickerSetupNotices", () => {
  it("lists instances that need setup as short lines on Favorites, even beside favorites", () => {
    const result = resolveModelPickerSetupNotices({
      entries: ENTRIES,
      needsSetup,
      selectedInstanceId: "favorites",
      selectedInstanceKnown: false,
      filteredModelCount: 3,
    });
    expect(result.variant).toBe("compact");
    expect(result.entries.map((candidate) => candidate.instanceId)).toEqual(["viet"]);
  });

  it("keeps the full notice on the instance's own tab only", () => {
    const own = resolveModelPickerSetupNotices({
      entries: ENTRIES,
      needsSetup,
      selectedInstanceId: ProviderInstanceId.make("viet"),
      selectedInstanceKnown: true,
      filteredModelCount: 0,
    });
    expect(own).toEqual({ entries: [ENTRIES[1]], variant: "full" });
    const other = resolveModelPickerSetupNotices({
      entries: ENTRIES,
      needsSetup,
      selectedInstanceId: ProviderInstanceId.make("hieu"),
      selectedInstanceKnown: true,
      filteredModelCount: 5,
    });
    expect(other.entries).toEqual([]);
  });
});

describe("modelPickerSetupSummary", () => {
  it("names the instance and the reason", () => {
    expect(modelPickerSetupSummary(entry("viet", "unauthenticated"))).toBe(
      "Claude viet is not signed in",
    );
    expect(modelPickerSetupSummary(entry("dung", "unauthenticated", false))).toBe(
      "Claude dung is not installed",
    );
    expect(modelPickerSetupSummary(entry("hieu", "unknown"))).toBe("Claude hieu needs setup");
  });
});
