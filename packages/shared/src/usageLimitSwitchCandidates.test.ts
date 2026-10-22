import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  chooseAccountForTurn,
  pickRepresentativeAccount,
  rankUsageLimitSwitchCandidates,
} from "./usageLimitSwitchCandidates.ts";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const iso = (offsetMinutes: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(NOW + offsetMinutes * 60_000));
const id = (value: string) => ProviderInstanceId.make(value);

interface WindowUsage {
  readonly id?: string;
  readonly kind?: "session" | "weekly";
  readonly usedPercent: number;
  readonly resetsInMinutes: number;
}

const makeProvider = (input: {
  readonly instanceId: string;
  readonly groupKey?: string | null;
  readonly enabled?: boolean;
  readonly installed?: boolean;
  readonly authStatus?: "authenticated" | "unauthenticated" | "unknown";
  readonly status?: "ready" | "warning" | "error" | "disabled";
  readonly availability?: "available" | "unavailable";
  readonly models?: ReadonlyArray<string>;
  readonly usage?: WindowUsage | ReadonlyArray<WindowUsage>;
  readonly unavailable?: boolean;
}): ServerProvider => {
  const usage = input.usage === undefined ? [] : [input.usage].flat();
  return {
    instanceId: id(input.instanceId),
    driver: "claudeAgent",
    enabled: input.enabled ?? true,
    installed: input.installed ?? true,
    status: input.status ?? "ready",
    auth: { status: input.authStatus ?? "authenticated" },
    ...(input.availability === undefined ? {} : { availability: input.availability }),
    models: (input.models ?? ["claude-opus-5-5"]).map((slug) => ({
      slug,
      name: slug,
      isCustom: false,
    })),
    ...(input.groupKey === null
      ? {}
      : { continuation: { groupKey: input.groupKey ?? "claude:home:/shared" } }),
    usageLimits: {
      checkedAt: iso(0),
      windows: usage.map((window) => ({
        id: window.id ?? "five_hour",
        kind: window.kind ?? "session",
        label: "Session",
        usedPercent: window.usedPercent,
        resetsAt: iso(window.resetsInMinutes),
      })),
      ...(input.unavailable === true ? { unavailable: { reason: "probeFailed" as const } } : {}),
    },
  } as unknown as ServerProvider;
};

const rank = (
  providers: ReadonlyArray<ServerProvider>,
  options: {
    readonly model?: string;
    readonly recentAssignments?: ReadonlyMap<ProviderInstanceId, number>;
  } = {},
) =>
  rankUsageLimitSwitchCandidates({
    providers,
    currentInstanceId: id("a"),
    nowMs: NOW,
    ...options,
  }).map((candidate) => candidate.instanceId);

describe("rankUsageLimitSwitchCandidates", () => {
  const current = makeProvider({
    instanceId: "a",
    usage: { usedPercent: 100, resetsInMinutes: 60 },
  });
  const providers = [
    current,
    makeProvider({ instanceId: "b", usage: { usedPercent: 20, resetsInMinutes: 200 } }),
    makeProvider({ instanceId: "c", usage: { usedPercent: 95, resetsInMinutes: 10 } }),
    makeProvider({ instanceId: "d", usage: { usedPercent: 10, resetsInMinutes: 100 } }),
  ];

  it("puts the most remaining usage first, even over a sooner reset", () => {
    assert.deepEqual(rank(providers), [id("d"), id("b"), id("c")]);
  });

  it("breaks a headroom tie with the sooner reset", () => {
    const result = rank([
      current,
      makeProvider({ instanceId: "late", usage: { usedPercent: 40, resetsInMinutes: 200 } }),
      makeProvider({ instanceId: "soon", usage: { usedPercent: 40, resetsInMinutes: 20 } }),
    ]);
    assert.deepEqual(result, [id("soon"), id("late")]);
  });

  it("ranks by the fullest window and skips a peer full in any window", () => {
    const result = rank([
      current,
      makeProvider({
        instanceId: "weekly-high",
        usage: [
          { id: "five_hour", usedPercent: 5, resetsInMinutes: 100 },
          { id: "seven_day", usedPercent: 90, resetsInMinutes: 3000 },
        ],
      }),
      makeProvider({
        instanceId: "weekly-full",
        usage: [
          { id: "five_hour", usedPercent: 0, resetsInMinutes: 100 },
          { id: "seven_day", usedPercent: 100, resetsInMinutes: 3000 },
        ],
      }),
      makeProvider({ instanceId: "even", usage: { usedPercent: 50, resetsInMinutes: 100 } }),
    ]);
    assert.deepEqual(result, [id("even"), id("weekly-high")]);
  });

  it("skips peers that are signed out, missing, erroring, unavailable, or disabled", () => {
    const usage = { usedPercent: 0, resetsInMinutes: 10 };
    const result = rank([
      current,
      makeProvider({ instanceId: "signed-out", authStatus: "unauthenticated", usage }),
      makeProvider({ instanceId: "auth-unknown", authStatus: "unknown", usage }),
      makeProvider({ instanceId: "missing", installed: false, usage }),
      makeProvider({ instanceId: "broken", status: "error", usage }),
      makeProvider({ instanceId: "offline", availability: "unavailable", usage }),
      makeProvider({ instanceId: "off", enabled: false, usage }),
      makeProvider({ instanceId: "warned", status: "warning", usage }),
    ]);
    assert.deepEqual(result, [id("warned")]);
  });

  it("skips other groups and peers that are full", () => {
    const result = rank([
      current,
      makeProvider({
        instanceId: "other",
        groupKey: "claude:home:/elsewhere",
        usage: { usedPercent: 0, resetsInMinutes: 10 },
      }),
      makeProvider({ instanceId: "full", usage: { usedPercent: 100, resetsInMinutes: 10 } }),
      makeProvider({ instanceId: "ok", usage: { usedPercent: 50, resetsInMinutes: 10 } }),
    ]);
    assert.deepEqual(result, [id("ok")]);
  });

  it("keeps only peers that offer the thread's model, by slug or alias", () => {
    const usage = { usedPercent: 10, resetsInMinutes: 10 };
    const result = rank(
      [
        current,
        makeProvider({ instanceId: "max", models: ["claude-opus-5-5[1m]"], usage }),
        makeProvider({ instanceId: "pro", models: ["claude-sonnet-5-5"], usage }),
      ],
      { model: "claude-opus-5-5[1m]" },
    );
    assert.deepEqual(result, [id("max")]);
  });

  it("counts recent assignments against a peer to spread threads", () => {
    const usage = { usedPercent: 10, resetsInMinutes: 10 };
    const spread = [
      current,
      makeProvider({ instanceId: "b", usage }),
      makeProvider({ instanceId: "c", usage: { usedPercent: 15, resetsInMinutes: 10 } }),
    ];
    assert.deepEqual(rank(spread), [id("b"), id("c")]);
    assert.deepEqual(rank(spread, { recentAssignments: new Map([[id("b"), 1]]) }), [
      id("c"),
      id("b"),
    ]);
  });

  it("treats a window that already reset as empty", () => {
    const result = rank([
      current,
      makeProvider({ instanceId: "stale", usage: { usedPercent: 100, resetsInMinutes: -5 } }),
    ]);
    assert.deepEqual(result, [id("stale")]);
  });

  it("lists instances without a reading after measured ones", () => {
    const result = rank([
      current,
      makeProvider({ instanceId: "blind", unavailable: true }),
      makeProvider({ instanceId: "none" }),
      makeProvider({ instanceId: "seen", usage: { usedPercent: 90, resetsInMinutes: 10 } }),
    ]);
    assert.deepEqual(result, [id("seen"), id("blind"), id("none")]);
  });

  it("returns nothing when the current instance has no continuation group", () => {
    const withoutGroup = makeProvider({ instanceId: "a", groupKey: null });
    assert.deepEqual(rank([withoutGroup, providers[1]!]), []);
  });
});

describe("chooseAccountForTurn", () => {
  const thresholds = { sessionPercent: 90, weeklyPercent: 80 };
  const choose = (providers: ReadonlyArray<ServerProvider>) =>
    chooseAccountForTurn({
      providers,
      currentInstanceId: id("a"),
      model: "claude-opus-5-5",
      nowMs: NOW,
      thresholds,
    });
  const roomy = makeProvider({ instanceId: "b", usage: { usedPercent: 30, resetsInMinutes: 60 } });

  it("stays while every window is under its threshold", () => {
    const current = makeProvider({
      instanceId: "a",
      usage: [
        { usedPercent: 89, resetsInMinutes: 60 },
        { id: "seven_day", kind: "weekly", usedPercent: 79, resetsInMinutes: 3000 },
      ],
    });
    assert.deepInclude(choose([current, roomy]), {
      instanceId: id("a"),
      switched: false,
      reason: "under-threshold",
    });
  });

  it("moves to a roomy peer when the weekly window crosses its own threshold", () => {
    const current = makeProvider({
      instanceId: "a",
      usage: [
        { usedPercent: 10, resetsInMinutes: 60 },
        { id: "seven_day", kind: "weekly", usedPercent: 81, resetsInMinutes: 3000 },
      ],
    });
    const choice = choose([current, roomy]);
    assert.deepInclude(choice, { instanceId: id("b"), switched: true, reason: "near-limit" });
    assert.deepEqual(choice.pressure, {
      windowId: "seven_day",
      usedPercent: 81,
      thresholdPercent: 80,
    });
  });

  it("stays when no peer is twenty points under every threshold", () => {
    const current = makeProvider({
      instanceId: "a",
      usage: { usedPercent: 95, resetsInMinutes: 60 },
    });
    const tight = makeProvider({
      instanceId: "b",
      usage: { usedPercent: 70, resetsInMinutes: 60 },
    });
    const weeklyTight = makeProvider({
      instanceId: "c",
      usage: [
        { usedPercent: 5, resetsInMinutes: 60 },
        { id: "seven_day", kind: "weekly", usedPercent: 61, resetsInMinutes: 3000 },
      ],
    });
    const unmeasured = makeProvider({ instanceId: "d" });
    assert.deepInclude(choose([current, tight, weeklyTight, unmeasured]), {
      instanceId: id("a"),
      switched: false,
      reason: "no-peer-with-headroom",
    });
  });

  it("stays when the current account has no usage reading", () => {
    assert.deepInclude(choose([makeProvider({ instanceId: "a" }), roomy]), {
      instanceId: id("a"),
      switched: false,
      reason: "current-unmeasured",
    });
    assert.deepInclude(choose([makeProvider({ instanceId: "a", unavailable: true }), roomy]), {
      reason: "current-unmeasured",
    });
  });

  it("ignores a window that already reset", () => {
    const current = makeProvider({
      instanceId: "a",
      usage: { usedPercent: 99, resetsInMinutes: -1 },
    });
    assert.deepInclude(choose([current, roomy]), { switched: false, reason: "under-threshold" });
  });
});

describe("pickRepresentativeAccount", () => {
  const members = [
    makeProvider({ instanceId: "a", usage: { usedPercent: 60, resetsInMinutes: 60 } }),
    makeProvider({ instanceId: "b", usage: { usedPercent: 10, resetsInMinutes: 60 } }),
    makeProvider({ instanceId: "c", authStatus: "unauthenticated" }),
  ];
  const pick = (preferredInstanceId: ProviderInstanceId | undefined, list = members) =>
    pickRepresentativeAccount({
      members: list,
      preferredInstanceId,
      model: "claude-opus-5-5",
      nowMs: NOW,
    });

  it("keeps the thread's own account", () => {
    assert.equal(pick(id("a")), id("a"));
  });

  it("otherwise takes the ready member with the most headroom", () => {
    assert.equal(pick(undefined), id("b"));
    assert.equal(pick(id("elsewhere")), id("b"));
  });

  it("falls back to the first member when none is ready", () => {
    assert.equal(pick(undefined, [members[2]!]), id("c"));
  });
});
