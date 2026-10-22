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

import { type EarlySwitchThread, planEarlySwitch } from "./EarlyAccountSwitch.ts";

type MessageDispatch = Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const hieu = ProviderInstanceId.make("hieu");
const dung = ProviderInstanceId.make("dung");

const provider = (
  instanceId: ProviderInstanceId,
  usedPercent: number,
  authStatus: "authenticated" | "unauthenticated" = "authenticated",
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
      checkedAt: "2026-10-20T12:00:00.000Z",
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
}) =>
  planEarlySwitch({
    switchPinned: input.switchPinned ?? false,
    ...(input.switchNearLimit === undefined ? {} : { switchNearLimit: input.switchNearLimit }),
    ...(input.newThread === undefined ? {} : { newThread: input.newThread }),
    command: input.command ?? command(),
    thread: input.thread ?? thread,
    providers: [
      provider(
        hieu,
        input.currentPercent,
        input.currentSignedOut === true ? "unauthenticated" : "authenticated",
      ),
      provider(dung, 20),
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

  it("leaves continuations, steers, other accounts and server turns alone", () => {
    const untouched = [
      command({ manualContinuationOfRunId: RunId.make("run-1") }),
      command({ dispatchMode: { type: "steer_active", targetRunId: RunId.make("run-1") } }),
      command({ modelSelection: { instanceId: dung, model: "claude-opus-5-5" } }),
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
