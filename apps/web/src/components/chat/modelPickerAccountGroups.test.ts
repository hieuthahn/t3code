import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  mergeModelPickerAccountModels,
  mergeModelPickerAccountTabs,
  resolveModelPickerAccountAction,
  sameAccountGroup,
  shortAccountLabels,
} from "./modelPickerAccountGroups";

const id = ProviderInstanceId.make;
const GROUP = "claude:home:/shared";

const entry = (instanceId: string, continuationGroupKey: string | null = GROUP) => ({
  instanceId: id(instanceId),
  driverKind: ProviderDriverKind.make("claudeAgent"),
  continuationGroupKey: continuationGroupKey ?? undefined,
  displayName: instanceId,
});

const model = (
  instanceId: string,
  slug: string,
  continuationGroupKey: string | undefined = GROUP,
) => ({
  slug,
  instanceId: id(instanceId),
  driverKind: ProviderDriverKind.make("claudeAgent"),
  continuationGroupKey,
});

const provider = (instanceId: string, usedPercent: number) =>
  ({
    instanceId: id(instanceId),
    driver: "claudeAgent",
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    models: [
      { slug: "opus", name: "Opus", isCustom: false },
      { slug: "opus-1m", name: "Opus 1M", isCustom: false },
    ],
    usageLimits: {
      checkedAt: "2026-10-20T12:00:00.000Z",
      windows: [{ id: "five_hour", kind: "session", label: "Session", usedPercent }],
    },
  }) as unknown as ServerProvider;

const NOW = Date.parse("2026-10-20T12:00:00.000Z");

describe("mergeModelPickerAccountTabs", () => {
  it("folds a group into one tab on the active account and keeps ungrouped entries", () => {
    const result = mergeModelPickerAccountTabs({
      entries: [entry("hieu"), entry("viet"), entry("dung"), entry("solo", null)],
      activeInstanceId: id("dung"),
    });
    expect(result.entries.map((tab) => [tab.instanceId, tab.displayName])).toEqual([
      [id("dung"), "dung (3 accounts)"],
      [id("solo"), "solo"],
    ]);
    expect(result.tabByInstanceId.get(id("hieu"))).toBe(id("dung"));
    expect(result.tabByInstanceId.get(id("solo"))).toBe(id("solo"));
  });
});

describe("mergeModelPickerAccountModels", () => {
  const providersByInstanceId = new Map([
    [id("hieu"), provider("hieu", 70)],
    [id("dung"), provider("dung", 10)],
  ]);

  it("shows each model once and keeps the thread's account when it offers the model", () => {
    const merged = mergeModelPickerAccountModels({
      models: [model("hieu", "opus"), model("dung", "opus"), model("dung", "opus-1m")],
      providersByInstanceId,
      activeInstanceId: id("hieu"),
      nowMs: NOW,
    });
    expect(merged.map((row) => [row.slug, row.instanceId, row.memberInstanceIds])).toEqual([
      ["opus", id("hieu"), [id("hieu"), id("dung")]],
      ["opus-1m", id("dung"), [id("dung")]],
    ]);
  });

  it("picks the roomiest account when the thread runs elsewhere", () => {
    const merged = mergeModelPickerAccountModels({
      models: [model("hieu", "opus"), model("dung", "opus")],
      providersByInstanceId,
      activeInstanceId: id("codex"),
      nowMs: NOW,
    });
    expect(merged.map((row) => row.instanceId)).toEqual([id("dung")]);
  });

  it("keeps models of other groups apart", () => {
    const merged = mergeModelPickerAccountModels({
      models: [model("hieu", "opus"), model("work", "opus", "claude:home:/work")],
      providersByInstanceId,
      activeInstanceId: id("hieu"),
      nowMs: NOW,
    });
    expect(merged).toHaveLength(2);
  });
});

describe("sameAccountGroup", () => {
  it("matches accounts that share a history and nothing else", () => {
    expect(sameAccountGroup(entry("hieu"), entry("dung"))).toBe(true);
    expect(sameAccountGroup(entry("hieu"), entry("work", "claude:home:/work"))).toBe(false);
    expect(sameAccountGroup(entry("solo", null), entry("solo", null))).toBe(true);
    expect(sameAccountGroup(entry("a", null), entry("b", null))).toBe(false);
  });
});

describe("resolveModelPickerAccountAction", () => {
  const members = [id("hieu"), id("dung")];
  const resolve = (accountPick: string, additive: boolean, canToggle: boolean) =>
    resolveModelPickerAccountAction({
      instanceId: id("hieu"),
      memberInstanceIds: members,
      accountPick: accountPick === "auto" ? "auto" : id(accountPick),
      additive,
      canToggle,
    });

  it("pins the picked account even while several models can be selected", () => {
    expect(resolve("dung", false, true)).toEqual({
      kind: "select",
      instanceId: id("dung"),
      accountChoice: "pinned",
    });
  });

  it("adds the picked account's model when the click adds to the selection", () => {
    expect(resolve("dung", true, true)).toEqual({ kind: "toggle", instanceId: id("dung") });
  });

  it("keeps Auto on the row's account", () => {
    expect(resolve("auto", false, true)).toEqual({
      kind: "select",
      instanceId: id("hieu"),
      accountChoice: "auto",
    });
  });

  it("ignores a picked account that does not offer the model", () => {
    expect(resolve("work", false, false)).toEqual({
      kind: "select",
      instanceId: id("hieu"),
      accountChoice: "auto",
    });
  });

  it("selects instead of toggling when the picker takes one model", () => {
    expect(resolve("dung", true, false).kind).toBe("select");
  });
});

describe("shortAccountLabels", () => {
  it("keeps an email's local part", () => {
    expect(shortAccountLabels(["Claude hieu.nguyen@openreach.tech", "Claude dung@x.tech"])).toEqual(
      ["hieu.nguyen", "dung"],
    );
  });

  it("drops the driver word every account shares", () => {
    expect(shortAccountLabels(["Codex hieuthahn", "Codex hieuthahn1"])).toEqual([
      "hieuthahn",
      "hieuthahn1",
    ]);
  });

  it("keeps names whole when nothing is shared", () => {
    expect(shortAccountLabels(["Codex", "Work Codex"])).toEqual(["Codex", "Work Codex"]);
  });
});
