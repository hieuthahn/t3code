import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationV2Run,
  ProviderInstanceId,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import {
  AccountSwitchJournal,
  accountSwitchNoticeText,
  layer,
  notePressure,
  previousStartedRun,
} from "./AccountSwitchJournal.ts";

const personal = ProviderInstanceId.make("claude-personal");
const work = ProviderInstanceId.make("claude-work");
const thread = ThreadId.make("thread-1");

describe("accountSwitchNoticeText", () => {
  it("names the window that pushed the account over", () => {
    assert.equal(
      accountSwitchNoticeText({
        fromName: "Personal",
        toName: "Work",
        note: {
          from: personal,
          to: work,
          reason: "near-limit",
          pressure: { windowLabel: "5-hour", usedPercent: 91.6 },
        },
      }),
      "Switched to Work because Personal reached 92% of its 5-hour limit",
    );
  });

  it("says the turn continued when the switch happened mid-turn or at the limit", () => {
    assert.equal(
      accountSwitchNoticeText({
        fromName: "Personal",
        toName: "Work",
        note: {
          from: personal,
          to: work,
          reason: "mid-turn",
          pressure: { windowLabel: "7-day", usedPercent: 95 },
        },
      }),
      "Continued on Work because Personal reached 95% of its 7-day limit",
    );
    assert.equal(
      accountSwitchNoticeText({
        fromName: "Personal",
        toName: "Work",
        note: { from: personal, to: work, reason: "usage-limit" },
      }),
      "Continued on Work because Personal hit its usage limit",
    );
  });

  it("falls back to the plain move when no switch recorded a reason", () => {
    assert.equal(
      accountSwitchNoticeText({ fromName: "Personal", toName: "Work", note: undefined }),
      "Switched to Work from Personal",
    );
  });
});

describe("notePressure", () => {
  it("labels the window from the account's usage reading", () => {
    const providers = [
      {
        instanceId: personal,
        usageLimits: {
          checkedAt: "2026-10-20T12:00:00.000Z",
          windows: [{ id: "five_hour", kind: "session", label: "5-hour", usedPercent: 93 }],
        },
      },
    ] as unknown as ReadonlyArray<ServerProvider>;
    assert.deepEqual(
      notePressure(providers, personal, { windowId: "five_hour", usedPercent: 93 }),
      { windowLabel: "5-hour", usedPercent: 93 },
    );
    assert.isUndefined(
      notePressure(providers, personal, { windowId: "seven_day", usedPercent: 93 }),
    );
  });
});

describe("AccountSwitchJournal", () => {
  it.effect("hands a note to the run that starts on its target account once", () =>
    Effect.gen(function* () {
      const journal = yield* AccountSwitchJournal;
      yield* journal.record(thread, { from: personal, to: work, reason: "usage-limit" });
      assert.isTrue(Option.isNone(yield* journal.take(thread, personal)));
      const taken = yield* journal.take(thread, work);
      assert.equal(Option.getOrUndefined(taken)?.reason, "usage-limit");
      assert.isTrue(Option.isNone(yield* journal.take(thread, work)));
    }).pipe(Effect.provide(layer)),
  );
});

describe("previousStartedRun", () => {
  const run = (ordinal: number, started: boolean) =>
    ({
      id: `run-${ordinal}`,
      ordinal,
      startedAt: started ? "2026-10-20T12:00:00.000Z" : null,
    }) as unknown as OrchestrationV2Run;

  it("skips runs that never started and runs after this one", () => {
    const runs = [run(1, true), run(2, true), run(3, false), run(4, true), run(5, true)];
    assert.equal(previousStartedRun(run(4, true), runs)?.ordinal, 2);
    assert.isUndefined(previousStartedRun(run(1, true), runs));
  });
});

describe("AccountSwitchJournal expiry", () => {
  it.effect("forgets a note whose switch never started a run", () =>
    Effect.gen(function* () {
      const journal = yield* AccountSwitchJournal;
      yield* journal.record(thread, { from: personal, to: work, reason: "mid-turn" });
      yield* TestClock.adjust("6 minutes");
      assert.isTrue(Option.isNone(yield* journal.take(thread, work)));
    }).pipe(Effect.provide(layer)),
  );
});
