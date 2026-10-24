import { TEAM_SILENCE_LIMIT_MS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { decideTeamTick, type TeamTick } from "./teamSupervisor.ts";

const now = 10 * TEAM_SILENCE_LIMIT_MS;

const tick = (overrides: Partial<TeamTick> = {}): TeamTick => ({
  status: "running",
  now,
  architect: {
    threadId: "architect",
    hasActiveRun: false,
    waitingOnUser: false,
    lastEventSeenAt: now,
    latestRunId: "run-2",
  },
  workers: [],
  runningAssignments: 0,
  startableAssignments: 0,
  wokeForLatestRun: false,
  openAssignments: 0,
  stalls: 0,
  lastStallRunId: null,
  ...overrides,
});

describe("decideTeamTick", () => {
  it("continues the plan once when the architect stops with nothing running", () => {
    expect(decideTeamTick(tick())).toEqual([{ type: "continue_plan", stalls: 1, runId: "run-2" }]);
  });

  it("pauses and reports on the second stall in a row", () => {
    const actions = decideTeamTick(
      tick({ stalls: 1, lastStallRunId: "run-1", openAssignments: 2 }),
    );
    expect(actions).toEqual([
      {
        type: "pause",
        runId: "run-2",
        report:
          "The architect stopped twice while 2 assignments could not start. The team paused; resume it after you check the plan.",
      },
    ]);
  });

  it("counts one architect run as one stall", () => {
    expect(decideTeamTick(tick({ stalls: 1, lastStallRunId: "run-2" }))).toEqual([]);
  });

  it("waits without a stall while workers run or the architect works", () => {
    expect(decideTeamTick(tick({ runningAssignments: 1 }))).toEqual([]);
    expect(
      decideTeamTick(tick({ architect: { ...tick().architect, hasActiveRun: true } })),
    ).toEqual([]);
  });

  it("wakes the architect to start assignments that only wait for its turn", () => {
    expect(decideTeamTick(tick({ startableAssignments: 2 }))).toEqual([
      { type: "wake_architect", reason: "start_queued" },
    ]);
  });

  it("waits for the woken architect instead of counting a stall", () => {
    expect(decideTeamTick(tick({ startableAssignments: 2, wokeForLatestRun: true }))).toEqual([]);
  });

  it("stops a turn silent for 20 minutes unless it waits on the user", () => {
    const quiet = { hasActiveRun: true, lastEventSeenAt: now - TEAM_SILENCE_LIMIT_MS };
    const actions = decideTeamTick(
      tick({
        runningAssignments: 2,
        workers: [
          { threadId: "silent", waitingOnUser: false, ...quiet },
          { threadId: "asking", waitingOnUser: true, ...quiet },
          { threadId: "busy", waitingOnUser: false, hasActiveRun: true, lastEventSeenAt: now - 1 },
        ],
      }),
    );
    expect(actions).toEqual([{ type: "interrupt", threadId: "silent" }]);
  });

  it("does nothing for a team that is not running", () => {
    expect(decideTeamTick(tick({ status: "paused" }))).toEqual([]);
    expect(decideTeamTick(tick({ status: "interrupted" }))).toEqual([]);
  });
});
