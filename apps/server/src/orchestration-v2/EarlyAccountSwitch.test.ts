import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  type OrchestrationV2Command,
  ProviderInstanceId,
  RunId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";

import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AccountSwitchJournal from "./AccountSwitchJournal.ts";
import * as EarlyAccountSwitch from "./EarlyAccountSwitch.ts";
import {
  type EarlySwitchThread,
  followThreadAccount,
  planEarlySwitch,
} from "./EarlyAccountSwitch.ts";

type MessageDispatch = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const hieu = ProviderInstanceId.make("hieu");
const dung = ProviderInstanceId.make("dung");

const provider = (
  instanceId: ProviderInstanceId,
  usedPercent: number,
  authStatus: "authenticated" | "unauthenticated" = "authenticated",
  checkedAt = "2026-10-20T12:00:00.000Z",
): ServerProvider =>
  ({
    instanceId,
    driver: "claudeAgent",
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: authStatus },
    models: [{ slug: "claude-opus-5-5", name: "Opus", isCustom: false }],
    continuation: { groupKey: "claude:home:/shared" },
    usageLimits: {
      checkedAt,
      windows: [
        {
          id: "five_hour",
          kind: "session",
          label: "Session",
          usedPercent,
          resetsAt: "2026-10-20T14:00:00.000Z",
        },
      ],
    },
  }) as unknown as ServerProvider;

const thread: EarlySwitchThread = {
  id: ThreadId.make("thread-1"),
  modelSelection: { instanceId: hieu, model: "claude-opus-5-5" },
};

const command = (overrides: Partial<MessageDispatch> = {}): MessageDispatch =>
  ({
    type: "message.dispatch",
    commandId: CommandId.make("command-1"),
    messageId: MessageId.make("message-1"),
    threadId: thread.id,
    text: "next step",
    attachments: [],
    dispatchMode: { type: "start_immediately" },
    createdBy: "user",
    ...overrides,
  }) as MessageDispatch;

const plan = (input: {
  readonly command?: MessageDispatch;
  readonly thread?: EarlySwitchThread;
  readonly currentPercent: number;
  readonly lastSwitchAtMs?: number;
  readonly switchPinned?: boolean;
  readonly switchNearLimit?: boolean;
  readonly newThread?: { readonly recentAssignments: ReadonlyMap<ProviderInstanceId, number> };
  readonly currentSignedOut?: boolean;
  readonly peerPercent?: number;
}) =>
  planEarlySwitch({
    switchPinned: input.switchPinned ?? false,
    ...(input.switchNearLimit === undefined ? {} : { switchNearLimit: input.switchNearLimit }),
    ...(input.newThread === undefined ? {} : { newThread: input.newThread }),
    command: input.command ?? command(),
    thread:
      input.thread ??
      (input.newThread === undefined ? thread : { ...thread, hasStartedRun: false }),
    providers: [
      provider(
        hieu,
        input.currentPercent,
        input.currentSignedOut === true ? "unauthenticated" : "authenticated",
      ),
      provider(dung, input.peerPercent ?? 20),
    ],
    thresholdsFor: () => ({ sessionPercent: 90, weeklyPercent: 90 }),
    lastSwitchAtMs: input.lastSwitchAtMs,
    nowMs: NOW,
  });

describe("planEarlySwitch", () => {
  it("moves a user turn to the roomy account once the current one crosses its threshold", () => {
    const result = plan({ currentPercent: 92 });
    assert.equal(result.command.modelSelection?.instanceId, dung);
    assert.equal(result.command.modelSelection?.model, "claude-opus-5-5");
    assert.equal(result.choice?.reason, "near-limit");
    assert.deepEqual(result.choice?.pressure, {
      windowId: "five_hour",
      usedPercent: 92,
      thresholdPercent: 90,
    });
  });

  it("keeps the turn on its account under the threshold", () => {
    const result = plan({ currentPercent: 89 });
    assert.isUndefined(result.command.modelSelection);
    assert.equal(result.choice?.reason, "under-threshold");
  });

  it("waits thirty minutes after a switch before switching the thread again", () => {
    assert.isNull(plan({ currentPercent: 95, lastSwitchAtMs: NOW - 29 * 60_000 }).choice);
    assert.equal(
      plan({ currentPercent: 95, lastSwitchAtMs: NOW - 31 * 60_000 }).command.modelSelection
        ?.instanceId,
      dung,
    );
  });

  it("keeps a pinned thread on its account unless pinned threads may switch", () => {
    const pinned = command({
      modelSelection: { instanceId: hieu, model: "claude-opus-5-5", accountChoice: "pinned" },
    });
    assert.isNull(plan({ command: pinned, currentPercent: 99 }).choice);
    const pinnedThread: EarlySwitchThread = {
      ...thread,
      modelSelection: { ...thread.modelSelection, accountChoice: "pinned" },
    };
    assert.isNull(plan({ thread: pinnedThread, currentPercent: 99 }).choice);
    assert.equal(
      plan({ command: pinned, currentPercent: 99, switchPinned: true }).command.modelSelection
        ?.instanceId,
      dung,
    );
  });

  it("leaves continuations, steers and server turns alone", () => {
    const untouched = [
      command({ manualContinuationOfRunId: RunId.make("run-1") }),
      command({ dispatchMode: { type: "steer_active", targetRunId: RunId.make("run-1") } }),
      command({ createdBy: "system" } as Partial<MessageDispatch>),
    ];
    for (const candidate of untouched) {
      assert.isNull(plan({ command: candidate, currentPercent: 99 }).choice);
    }
  });
});

describe("planEarlySwitch for new threads", () => {
  const fresh = { recentAssignments: new Map<ProviderInstanceId, number>() };

  it("starts a new thread on the account with more headroom", () => {
    const result = plan({ currentPercent: 50, newThread: fresh });
    assert.equal(result.command.modelSelection?.instanceId, dung);
    assert.equal(result.choice?.reason, "new-thread");
  });

  it("keeps a new thread whose account was picked by hand", () => {
    const result = plan({
      currentPercent: 50,
      newThread: fresh,
      command: command({
        modelSelection: { instanceId: hieu, model: "claude-opus-5-5", accountChoice: "pinned" },
      }),
    });
    assert.equal(result.command.modelSelection?.instanceId ?? hieu, hieu);
    assert.isNull(result.choice);
  });

  it("balances a launched thread whose first run waits for its workspace", () => {
    const result = plan({
      currentPercent: 50,
      newThread: fresh,
      command: command({
        dispatchMode: { type: "defer_start", workspaceStrategy: { type: "root" } },
      } as Partial<MessageDispatch>),
    });
    assert.equal(result.command.modelSelection?.instanceId, dung);
  });

  it("leaves a thread with earlier turns to the threshold rule", () => {
    const result = plan({ currentPercent: 50 });
    assert.isUndefined(result.command.modelSelection);
  });
});

describe("planEarlySwitch with switching near the limit off", () => {
  it("stays on a pressured account", () => {
    const result = plan({ currentPercent: 95, switchNearLimit: false });
    assert.isUndefined(result.command.modelSelection);
  });

  it("still moves off a signed-out account", () => {
    const result = plan({ currentPercent: 10, switchNearLimit: false, currentSignedOut: true });
    assert.equal(result.command.modelSelection?.instanceId, dung);
    assert.equal(result.choice?.reason, "current-signed-out");
  });
});

describe("planEarlySwitch for a turn that names another unpinned account", () => {
  const onDung: EarlySwitchThread = {
    ...thread,
    modelSelection: { instanceId: dung, model: "claude-opus-5-5" },
  };
  const askHieu = command({ modelSelection: { instanceId: hieu, model: "claude-opus-5-5" } });

  it("moves the turn off a pressured account the client still names", () => {
    const result = plan({ thread: onDung, command: askHieu, currentPercent: 95 });
    assert.equal(result.command.modelSelection?.instanceId, dung);
    assert.equal(result.choice?.reason, "near-limit");
  });

  it("keeps a named account under its threshold, or one pinned by hand", () => {
    const roomy = plan({ thread: onDung, command: askHieu, currentPercent: 50 });
    assert.equal(roomy.command.modelSelection?.instanceId, hieu);
    assert.equal(roomy.choice?.reason, "under-threshold");
    const pinned = command({
      modelSelection: { instanceId: hieu, model: "claude-opus-5-5", accountChoice: "pinned" },
    });
    assert.isNull(plan({ thread: onDung, command: pinned, currentPercent: 100 }).choice);
  });

  it("returns a full account's turn to the thread's own account when no peer has headroom", () => {
    const result = plan({
      thread: onDung,
      command: askHieu,
      currentPercent: 100,
      peerPercent: 85,
      switchNearLimit: false,
      lastSwitchAtMs: NOW - 60_000,
    });
    assert.equal(result.command.modelSelection?.instanceId, dung);
    assert.equal(result.choice?.reason, "requested-spent");
  });
});

describe("followThreadAccount", () => {
  const onDung: EarlySwitchThread = {
    ...thread,
    modelSelection: { instanceId: dung, model: "claude-opus-5-5" },
  };
  const providers = [provider(hieu, 95), provider(dung, 20)];
  const staleDraft = command({ modelSelection: { instanceId: hieu, model: "claude-opus-5-5" } });

  it("keeps a thread on the account the server moved it to when the draft lags", () => {
    assert.equal(
      followThreadAccount(staleDraft, onDung, providers).modelSelection?.instanceId,
      dung,
    );
  });

  it("honors a pinned pick, a server continuation and an account outside the group", () => {
    const pinned = command({
      modelSelection: { instanceId: hieu, model: "claude-opus-5-5", accountChoice: "pinned" },
    });
    assert.equal(followThreadAccount(pinned, onDung, providers), pinned);
    const continuation = command({
      modelSelection: { instanceId: hieu, model: "claude-opus-5-5" },
      manualContinuationOfRunId: RunId.make("run-1"),
    });
    assert.equal(followThreadAccount(continuation, onDung, providers), continuation);
    const elsewhere = [
      provider(dung, 20),
      { ...provider(hieu, 95), continuation: { groupKey: "claude:home:/other" } },
    ] as ReadonlyArray<ServerProvider>;
    assert.equal(followThreadAccount(staleDraft, onDung, elsewhere), staleDraft);
  });
});

describe("EarlyAccountSwitch.rewrite", () => {
  const STALE_AT = "2026-10-20T11:50:00.000Z";
  const FRESH_AT = "2026-10-20T11:59:30.000Z";
  const otherThread: EarlySwitchThread = { ...thread, id: ThreadId.make("thread-2") };

  const harness = Effect.fn("EarlyAccountSwitchTest.harness")(function* (input: {
    readonly providers: ReadonlyArray<ServerProvider>;
    readonly mergeAccounts?: boolean;
    readonly refresh?: (
      instanceId: ProviderInstanceId,
      publish: (providers: ReadonlyArray<ServerProvider>) => Effect.Effect<void>,
    ) => Effect.Effect<void>;
  }) {
    yield* TestClock.setTime(NOW);
    const base = yield* ProviderRegistry.ProviderRegistry.pipe(
      Effect.provide(ProviderRegistryMock.layer([])),
    );
    const providersRef = yield* Ref.make(input.providers);
    const refreshedRef = yield* Ref.make<ReadonlyArray<ProviderInstanceId>>([]);
    const registry = ProviderRegistry.ProviderRegistry.of({
      ...base,
      getProviders: Ref.get(providersRef),
      refreshInstance: (instanceId) =>
        Ref.update(refreshedRef, (ids) => [...ids, instanceId]).pipe(
          Effect.andThen(
            input.refresh?.(instanceId, (next) => Ref.set(providersRef, next)) ?? Effect.void,
          ),
          Effect.andThen(Ref.get(providersRef)),
        ),
    });
    const journal = yield* AccountSwitchJournal.make;
    const service = yield* EarlyAccountSwitch.make.pipe(
      Effect.provide(
        Layer.mergeAll(
          ServerSettings.ServerSettingsService.layerTest({
            ...(input.mergeAccounts === undefined
              ? {}
              : { modelPickerMergeAccounts: input.mergeAccounts }),
            earlySwitchSessionThreshold: 90,
            earlySwitchWeeklyThreshold: 90,
          }),
          Layer.succeed(ProviderRegistry.ProviderRegistry, registry),
          Layer.succeed(AccountSwitchJournal.AccountSwitchJournal, journal),
        ),
      ),
    );
    return { service, journal, refreshed: Ref.get(refreshedRef) };
  });

  const pair = (current: ServerProvider, peer: ServerProvider) => [current, peer];

  it.effect("records why a turn moved to another account", () =>
    Effect.gen(function* () {
      const { service, journal } = yield* harness({
        providers: pair(provider(hieu, 92), provider(dung, 20)),
      });
      const rewritten = yield* service.rewrite(command(), thread);
      assert.equal(rewritten.modelSelection?.instanceId, dung);
      const note = yield* journal.take(thread.id, dung);
      assert.deepEqual(Option.getOrUndefined(note), {
        from: hieu,
        to: dung,
        reason: "near-limit",
        pressure: { windowLabel: "Session", usedPercent: 92 },
      });
    }),
  );

  it.effect("records a signed-out account without a usage window", () =>
    Effect.gen(function* () {
      const { service, journal } = yield* harness({
        providers: pair(provider(hieu, 10, "unauthenticated"), provider(dung, 20)),
      });
      yield* service.rewrite(command(), thread);
      const note = Option.getOrUndefined(yield* journal.take(thread.id, dung));
      assert.equal(note?.reason, "signed-out");
      assert.isUndefined(note?.pressure);
    }),
  );

  it.effect("records a usage-limit return to the thread's own account", () =>
    Effect.gen(function* () {
      const { service, journal } = yield* harness({
        providers: pair(provider(hieu, 100), provider(dung, 85)),
        mergeAccounts: false,
      });
      const onDung: EarlySwitchThread = {
        ...thread,
        modelSelection: { instanceId: dung, model: "claude-opus-5-5" },
      };
      const askHieu = command({
        modelSelection: { instanceId: hieu, model: "claude-opus-5-5" },
      });
      const rewritten = yield* service.rewrite(askHieu, onDung);
      assert.equal(rewritten.modelSelection?.instanceId, dung);
      const note = Option.getOrUndefined(yield* journal.take(thread.id, dung));
      assert.equal(note?.reason, "usage-limit");
      assert.equal(note?.from, hieu);
    }),
  );

  it.effect("follows the thread's account silently when a merged picker's draft lags", () =>
    Effect.gen(function* () {
      const { service, journal } = yield* harness({
        providers: pair(provider(hieu, 100), provider(dung, 85)),
      });
      const onDung: EarlySwitchThread = {
        ...thread,
        modelSelection: { instanceId: dung, model: "claude-opus-5-5" },
      };
      const rewritten = yield* service.rewrite(
        command({ modelSelection: { instanceId: hieu, model: "claude-opus-5-5" } }),
        onDung,
      );
      assert.equal(rewritten.modelSelection?.instanceId, dung);
      assert.isTrue(Option.isNone(yield* journal.take(thread.id, dung)));
    }),
  );

  it.effect("records nothing when the turn stays or a new thread is balanced", () =>
    Effect.gen(function* () {
      const stays = yield* harness({ providers: pair(provider(hieu, 50), provider(dung, 20)) });
      yield* stays.service.rewrite(command(), thread);
      assert.isTrue(Option.isNone(yield* stays.journal.take(thread.id, dung)));
      assert.isTrue(Option.isNone(yield* stays.journal.take(thread.id, hieu)));

      const balanced = yield* harness({ providers: pair(provider(hieu, 50), provider(dung, 20)) });
      const rewritten = yield* balanced.service.rewrite(command(), {
        ...thread,
        hasStartedRun: false,
      });
      assert.equal(rewritten.modelSelection?.instanceId, dung);
      assert.isTrue(Option.isNone(yield* balanced.journal.take(thread.id, dung)));
    }),
  );

  it.effect("reads a stale usage reading again before deciding", () =>
    Effect.gen(function* () {
      const { service, journal, refreshed } = yield* harness({
        providers: pair(provider(hieu, 50, "authenticated", STALE_AT), provider(dung, 20)),
        refresh: (instanceId, publish) =>
          instanceId === hieu ? publish(pair(provider(hieu, 95), provider(dung, 20))) : Effect.void,
      });
      const rewritten = yield* service.rewrite(command(), thread);
      assert.equal(rewritten.modelSelection?.instanceId, dung);
      assert.deepEqual(yield* refreshed, [hieu]);
      const note = Option.getOrUndefined(yield* journal.take(thread.id, dung));
      assert.deepEqual(note?.pressure, { windowLabel: "Session", usedPercent: 95 });
    }),
  );

  it.effect("reads stale peers again once the current account is pressured", () =>
    Effect.gen(function* () {
      const { service, refreshed } = yield* harness({
        providers: pair(
          provider(hieu, 92, "authenticated", FRESH_AT),
          provider(dung, 20, "authenticated", STALE_AT),
        ),
        refresh: (instanceId, publish) =>
          instanceId === dung
            ? publish(pair(provider(hieu, 92, "authenticated", FRESH_AT), provider(dung, 85)))
            : Effect.void,
      });
      const rewritten = yield* service.rewrite(command(), thread);
      assert.isUndefined(rewritten.modelSelection);
      assert.deepEqual(yield* refreshed, [dung]);
    }),
  );

  it.effect("does not read a fresh usage reading again", () =>
    Effect.gen(function* () {
      const { service, refreshed } = yield* harness({
        providers: pair(
          provider(hieu, 95, "authenticated", FRESH_AT),
          provider(dung, 20, "authenticated", FRESH_AT),
        ),
      });
      const rewritten = yield* service.rewrite(command(), thread);
      assert.equal(rewritten.modelSelection?.instanceId, dung);
      assert.deepEqual(yield* refreshed, []);
    }),
  );

  it.effect("does not read usage again when the early switch is not deciding", () =>
    Effect.gen(function* () {
      const { service, refreshed } = yield* harness({
        providers: pair(
          provider(hieu, 95, "authenticated", STALE_AT),
          provider(dung, 20, "authenticated", STALE_AT),
        ),
      });
      const pinned = command({
        modelSelection: { instanceId: hieu, model: "claude-opus-5-5", accountChoice: "pinned" },
      });
      yield* service.rewrite(pinned, thread);
      yield* service.rewrite(command({ createdBy: "system" } as Partial<MessageDispatch>), thread);
      yield* service.rewrite(command(), { ...thread, hasStartedRun: false });
      assert.deepEqual(yield* refreshed, []);
    }),
  );

  it.effect("decides on the cached reading when the refresh fails", () =>
    Effect.gen(function* () {
      const { service, refreshed } = yield* harness({
        providers: pair(provider(hieu, 92, "authenticated", STALE_AT), provider(dung, 20)),
        refresh: () => Effect.die("probe crashed"),
      });
      const rewritten = yield* service.rewrite(command(), thread);
      assert.equal(rewritten.modelSelection?.instanceId, dung);
      assert.deepEqual(yield* refreshed, [hieu]);
    }),
  );

  it.effect("decides on the cached reading when the refresh times out, and skips a repeat", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const { service, refreshed } = yield* harness({
        providers: pair(provider(hieu, 92, "authenticated", STALE_AT), provider(dung, 20)),
        refresh: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      });
      const first = yield* Effect.forkChild(service.rewrite(command(), thread));
      yield* Deferred.await(started);
      yield* TestClock.adjust("5 seconds");
      const rewritten = yield* Fiber.join(first);
      assert.equal(rewritten.modelSelection?.instanceId, dung);

      const second = yield* service.rewrite(command(), otherThread);
      assert.equal(second.modelSelection?.instanceId, dung);
      assert.deepEqual(yield* refreshed, [hieu]);
    }),
  );
});
