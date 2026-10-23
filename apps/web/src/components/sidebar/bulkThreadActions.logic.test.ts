import { describe, expect, it } from "vite-plus/test";

import {
  type BulkRunResult,
  type BulkThreadCandidate,
  describeBulkFailure,
  pickBulkToggle,
  planBulkThreadActions,
  runBulkThreadAction,
} from "./bulkThreadActions.logic";

function candidate(
  threadKey: string,
  overrides: Partial<Omit<BulkThreadCandidate, "threadKey">> = {},
): BulkThreadCandidate {
  return {
    threadKey,
    settled: false,
    pinned: false,
    canPin: true,
    canSnooze: true,
    ...overrides,
  };
}

describe("planBulkThreadActions", () => {
  it("splits settle and unsettle targets by each thread's settled state", () => {
    const plans = planBulkThreadActions([
      candidate("a"),
      candidate("b", { settled: true }),
      candidate("c"),
    ]);

    expect(plans.get("settle")?.targetKeys).toEqual(["a", "c"]);
    expect(plans.get("unsettle")?.targetKeys).toEqual(["b"]);
  });

  it("leaves threads without pin capability out of pin and unpin", () => {
    const plans = planBulkThreadActions([
      candidate("a", { pinned: true }),
      candidate("b", { canPin: false }),
      candidate("c"),
    ]);

    expect(plans.get("pin")?.targetKeys).toEqual(["c"]);
    expect(plans.get("unpin")?.targetKeys).toEqual(["a"]);
  });

  it("offers snooze only when every selected thread can snooze", () => {
    const allowed = planBulkThreadActions([candidate("a"), candidate("b")]);
    const blocked = planBulkThreadActions([candidate("a"), candidate("b", { canSnooze: false })]);

    expect(allowed.get("snooze")?.targetKeys).toEqual(["a", "b"]);
    expect(blocked.get("snooze")?.targetKeys).toEqual([]);
  });

  it("targets every selected thread for archive, mark unread and delete", () => {
    const plans = planBulkThreadActions([candidate("a", { settled: true }), candidate("b")]);

    expect(plans.get("archive")?.targetKeys).toEqual(["a", "b"]);
    expect(plans.get("mark-unread")?.targetKeys).toEqual(["a", "b"]);
    expect(plans.get("delete")?.targetKeys).toEqual(["a", "b"]);
  });
});

describe("pickBulkToggle", () => {
  it("shows the action that changes more threads, preferring forward on a tie", () => {
    const mostlyActive = planBulkThreadActions([
      candidate("a"),
      candidate("b"),
      candidate("c", { settled: true }),
    ]);
    const mostlySettled = planBulkThreadActions([
      candidate("a"),
      candidate("b", { settled: true }),
      candidate("c", { settled: true }),
    ]);
    const tied = planBulkThreadActions([candidate("a"), candidate("b", { settled: true })]);

    expect(pickBulkToggle(mostlyActive, "settle", "unsettle")).toBe("settle");
    expect(pickBulkToggle(mostlySettled, "settle", "unsettle")).toBe("unsettle");
    expect(pickBulkToggle(tied, "settle", "unsettle")).toBe("settle");
  });

  it("hides the toggle when neither side has a target", () => {
    const plans = planBulkThreadActions([candidate("a", { canPin: false })]);

    expect(pickBulkToggle(plans, "pin", "unpin")).toBeNull();
  });
});

describe("runBulkThreadAction", () => {
  type FakeResult = BulkRunResult & { readonly reason?: string };

  const run = (
    targets: readonly string[],
    execute: (target: string) => Promise<FakeResult>,
    concurrency?: number,
  ) =>
    runBulkThreadAction({
      targets,
      execute,
      isInterrupted: (result: FakeResult) => result.reason === "interrupted",
      describeFailure: (result: FakeResult) => new Error(result.reason),
      ...(concurrency === undefined ? {} : { concurrency }),
    });

  it("dispatches one command per target and reports successes", async () => {
    const dispatched: string[] = [];
    const outcome = await run(["a", "b", "c"], async (target) => {
      dispatched.push(target);
      return { _tag: "Success" };
    });

    expect([...dispatched].sort()).toEqual(["a", "b", "c"]);
    expect([...outcome.succeeded].sort()).toEqual(["a", "b", "c"]);
    expect(outcome.failed).toEqual([]);
  });

  it("keeps going past failures and thrown errors, collecting each one", async () => {
    const outcome = await run(["a", "b", "c", "d"], async (target) => {
      if (target === "b") return { _tag: "Failure", reason: "server rejected" };
      if (target === "c") throw new Error("socket closed");
      return { _tag: "Success" };
    });

    expect([...outcome.succeeded].sort()).toEqual(["a", "d"]);
    expect(outcome.failed.map(({ target }) => target).sort()).toEqual(["b", "c"]);
    expect(outcome.failed.map(({ error }) => (error as Error).message).sort()).toEqual([
      "server rejected",
      "socket closed",
    ]);
  });

  it("counts interrupted commands apart from failures", async () => {
    const outcome = await run(["a", "b"], async (target) =>
      target === "a" ? { _tag: "Failure", reason: "interrupted" } : { _tag: "Success" },
    );

    expect(outcome.interrupted).toEqual(["a"]);
    expect(outcome.failed).toEqual([]);
    expect(outcome.succeeded).toEqual(["b"]);
  });

  it("never runs more commands at once than the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const outcome = await run(
      Array.from({ length: 10 }, (_, index) => `t${index}`),
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight--;
        return { _tag: "Success" };
      },
      3,
    );

    expect(peak).toBe(3);
    expect(outcome.succeeded).toHaveLength(10);
  });

  it("resolves at once for an empty selection", async () => {
    const outcome = await run([], async () => ({ _tag: "Success" }));

    expect(outcome).toEqual({ succeeded: [], failed: [], interrupted: [] });
  });
});

describe("describeBulkFailure", () => {
  it("returns null when every command succeeded", () => {
    expect(describeBulkFailure("settle", { succeeded: ["a"], failed: [] })).toBeNull();
  });

  it("names the action and the failed share of the batch", () => {
    expect(
      describeBulkFailure("unsettle", {
        succeeded: ["a", "b"],
        failed: [{ target: "c", error: null }],
      }),
    ).toBe("Failed to un-settle 1 of 3 threads");
  });
});
