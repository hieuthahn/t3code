import { DEFAULT_TEAM_LIMITS, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  newAssignmentProblems,
  planTeamStarts,
  writeScopesOverlap,
  type ScheduledAssignment,
} from "./teamScheduler.ts";

const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claudeAgent");

const assignment = (
  key: string,
  overrides: Partial<ScheduledAssignment> = {},
): ScheduledAssignment => ({
  key,
  status: "waiting",
  attempts: 0,
  instanceId: codex,
  dependsOn: [],
  readOnly: false,
  files: [],
  isolation: "worktree",
  ...overrides,
});

const plan = (
  assignments: ReadonlyArray<ScheduledAssignment>,
  options: Partial<Parameters<typeof planTeamStarts>[0]> = {},
) =>
  planTeamStarts({
    assignments,
    maxParallel: "unlimited",
    paused: false,
    architectActive: true,
    ...options,
  });

describe("planTeamStarts", () => {
  it("holds an assignment until every dependency is done", () => {
    const result = plan([
      assignment("api", { status: "running" }),
      assignment("docs", { status: "done", instanceId: claude }),
      assignment("tests", { dependsOn: ["api", "docs"], instanceId: claude }),
    ]);
    expect(result.start).toEqual([]);
    expect(result.waits.get("tests")).toEqual({ _tag: "dependency", keys: ["api"] });
  });

  it("blocks an assignment whose dependency failed instead of starting it", () => {
    const result = plan([
      assignment("api", { status: "failed", attempts: 1 }),
      assignment("tests", { dependsOn: ["api"] }),
    ]);
    expect(result.waits.get("tests")).toEqual({ _tag: "dependency_failed", keys: ["api"] });
  });

  it("queues two writers whose files overlap on the shared checkout", () => {
    const result = plan([
      assignment("auth", { status: "running", isolation: "shared", files: ["src/auth"] }),
      assignment("login", {
        isolation: "shared",
        files: ["src/auth/login.ts"],
        instanceId: claude,
      }),
      assignment("billing", { isolation: "shared", files: ["src/billing"], instanceId: claude }),
    ]);
    expect(result.start).toEqual(["billing"]);
    expect(result.waits.get("login")).toEqual({
      _tag: "write_scope",
      key: "auth",
      files: ["src/auth"],
    });
  });

  it("lets readers and worktree writers share files with a running writer", () => {
    const result = plan([
      assignment("auth", { status: "running", isolation: "shared", files: ["src/auth"] }),
      assignment("review", {
        isolation: "shared",
        readOnly: true,
        files: ["src/auth"],
        instanceId: claude,
      }),
      assignment("rewrite", { isolation: "worktree", files: ["src/auth"], instanceId: claude }),
    ]);
    expect(result.start).toEqual(["review", "rewrite"]);
  });

  it("treats a shared writer without files as writing the whole checkout", () => {
    const result = plan([
      assignment("auth", { status: "running", isolation: "shared", files: ["src/auth"] }),
      assignment("sweep", { isolation: "shared", instanceId: claude }),
    ]);
    expect(result.waits.get("sweep")).toEqual({
      _tag: "write_scope",
      key: "auth",
      files: ["src/auth"],
    });
  });

  it("runs at most two workers on one provider account", () => {
    const result = plan([
      assignment("one"),
      assignment("two"),
      assignment("three"),
      assignment("other", { instanceId: claude }),
    ]);
    expect(result.start).toEqual(["one", "two", "other"]);
    expect(result.waits.get("three")).toEqual({
      _tag: "account_busy",
      instanceId: codex,
      running: 2,
    });
  });

  it("caps the whole team at maxParallel", () => {
    const result = plan([assignment("one"), assignment("two", { instanceId: claude })], {
      maxParallel: 1,
    });
    expect(result.start).toEqual(["one"]);
    expect(result.waits.get("two")).toEqual({ _tag: "team_parallel", limit: 1 });
  });

  it("starts nothing while the team is paused", () => {
    const result = plan([assignment("one")], { paused: true });
    expect(result.start).toEqual([]);
    expect(result.waits.get("one")).toEqual({ _tag: "team_paused" });
  });

  it("leaves a startable assignment for the architect's next turn", () => {
    const result = plan([assignment("one")], { architectActive: false });
    expect(result.start).toEqual([]);
    expect(result.waits.get("one")).toEqual({ _tag: "next_turn" });
  });
});

describe("writeScopesOverlap", () => {
  it("matches a folder with the files inside it and ignores siblings", () => {
    expect(writeScopesOverlap(["./src/auth/"], ["src/auth/login.ts"])).toEqual(["./src/auth/"]);
    expect(writeScopesOverlap(["src/auth"], ["src/authz"])).toBeNull();
  });
});

describe("newAssignmentProblems", () => {
  const check = (
    incoming: Parameters<typeof newAssignmentProblems>[0]["incoming"],
    existing: Parameters<typeof newAssignmentProblems>[0]["existing"] = [],
    usage = { rounds: 0, assignments: existing.length },
    limits = DEFAULT_TEAM_LIMITS,
  ) => newAssignmentProblems({ existing, incoming, limits, usage });

  it("refuses a key listed twice or already in use", () => {
    expect(
      check([
        { key: "api", dependsOn: [] },
        { key: "api", dependsOn: [] },
      ]),
    ).toEqual(["The batch lists api twice. Give each assignment its own key."]);
    expect(
      check([{ key: "api", dependsOn: [] }], [{ key: "api", status: "running", attempts: 1 }]),
    ).toEqual(["api is already running. Use a new key for new work."]);
  });

  it("retries a failed key until its third attempt", () => {
    expect(
      check([{ key: "api", dependsOn: [] }], [{ key: "api", status: "failed", attempts: 2 }]),
    ).toEqual([]);
    expect(
      check([{ key: "api", dependsOn: [] }], [{ key: "api", status: "failed", attempts: 3 }]),
    ).toEqual(["api already ran 3 times. Give it up or split it into new assignments."]);
  });

  it("refuses a dependency that is not on the team or listed later", () => {
    expect(
      check([
        { key: "tests", dependsOn: ["api"] },
        { key: "api", dependsOn: [] },
      ]),
    ).toEqual(["tests depends on api, which is neither on the team nor listed before it."]);
  });

  it("refuses a batch past the round or assignment limits", () => {
    const limits = { ...DEFAULT_TEAM_LIMITS, maxRounds: 2, maxAssignments: 2 };
    expect(
      check(
        [
          { key: "a", dependsOn: [] },
          { key: "b", dependsOn: [] },
        ],
        [{ key: "x", status: "done", attempts: 1 }],
        { rounds: 2, assignments: 1 },
        limits,
      ),
    ).toEqual([
      "The team used all 2 rounds. Finish with team_finish, or ask the user to raise the limit.",
      "The batch adds 2 assignments to the 1 made, over the limit of 2.",
    ]);
  });
});
