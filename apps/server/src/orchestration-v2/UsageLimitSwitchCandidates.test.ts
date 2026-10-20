import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { rankUsageLimitSwitchCandidates } from "./UsageLimitSwitchCandidates.ts";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const iso = (offsetMinutes: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(NOW + offsetMinutes * 60_000));
const id = (value: string) => ProviderInstanceId.make(value);

const makeProvider = (input: {
  readonly instanceId: string;
  readonly groupKey?: string | null;
  readonly enabled?: boolean;
  readonly usage?: { readonly usedPercent: number; readonly resetsInMinutes: number };
  readonly unavailable?: boolean;
}): ServerProvider =>
  ({
    instanceId: id(input.instanceId),
    driver: "claudeAgent",
    enabled: input.enabled ?? true,
    ...(input.groupKey === null
      ? {}
      : { continuation: { groupKey: input.groupKey ?? "claude:home:/shared" } }),
    usageLimits: {
      checkedAt: iso(0),
      windows:
        input.usage === undefined
          ? []
          : [
              {
                id: "five_hour",
                kind: "session",
                label: "Session",
                usedPercent: input.usage.usedPercent,
                resetsAt: iso(input.usage.resetsInMinutes),
              },
            ],
      ...(input.unavailable === true ? { unavailable: { reason: "probeFailed" as const } } : {}),
    },
  }) as unknown as ServerProvider;

const rank = (
  providers: ReadonlyArray<ServerProvider>,
  strategy: "soonest-reset" | "most-remaining",
) =>
  rankUsageLimitSwitchCandidates({
    providers,
    currentInstanceId: id("a"),
    windowId: "five_hour",
    nowMs: NOW,
    strategy,
  }).map((candidate) => candidate.instanceId);

describe("rankUsageLimitSwitchCandidates", () => {
  const current = makeProvider({ instanceId: "a", usage: { usedPercent: 100, resetsInMinutes: 60 } });
  const providers = [
    current,
    makeProvider({ instanceId: "b", usage: { usedPercent: 20, resetsInMinutes: 200 } }),
    makeProvider({ instanceId: "c", usage: { usedPercent: 70, resetsInMinutes: 30 } }),
    makeProvider({ instanceId: "d", usage: { usedPercent: 10, resetsInMinutes: 100 } }),
  ];

  it("puts the soonest reset first", () => {
    assert.deepEqual(rank(providers, "soonest-reset"), [id("c"), id("d"), id("b")]);
  });

  it("puts the most remaining usage first", () => {
    assert.deepEqual(rank(providers, "most-remaining"), [id("d"), id("b"), id("c")]);
  });

  it("skips other groups, disabled instances, and instances that are full", () => {
    const result = rank(
      [
        current,
        makeProvider({
          instanceId: "other",
          groupKey: "claude:home:/elsewhere",
          usage: { usedPercent: 0, resetsInMinutes: 10 },
        }),
        makeProvider({
          instanceId: "off",
          enabled: false,
          usage: { usedPercent: 0, resetsInMinutes: 10 },
        }),
        makeProvider({ instanceId: "full", usage: { usedPercent: 100, resetsInMinutes: 10 } }),
        makeProvider({ instanceId: "ok", usage: { usedPercent: 50, resetsInMinutes: 10 } }),
      ],
      "soonest-reset",
    );
    assert.deepEqual(result, [id("ok")]);
  });

  it("treats a window that already reset as empty", () => {
    const result = rank(
      [
        current,
        makeProvider({ instanceId: "stale", usage: { usedPercent: 100, resetsInMinutes: -5 } }),
      ],
      "most-remaining",
    );
    assert.deepEqual(result, [id("stale")]);
  });

  it("lists instances without a reading after measured ones", () => {
    const result = rank(
      [
        current,
        makeProvider({ instanceId: "blind", unavailable: true }),
        makeProvider({ instanceId: "none" }),
        makeProvider({ instanceId: "seen", usage: { usedPercent: 90, resetsInMinutes: 10 } }),
      ],
      "most-remaining",
    );
    assert.deepEqual(result, [id("seen"), id("blind"), id("none")]);
  });

  it("returns nothing when the current instance has no continuation group", () => {
    const withoutGroup = makeProvider({ instanceId: "a", groupKey: null });
    assert.deepEqual(rank([withoutGroup, providers[1]!], "soonest-reset"), []);
  });
});
