import type { DesktopForkUpdateState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  describeForkUpdateCheck,
  describeForkUpdateRun,
  forkUpdateBlockedReason,
} from "./ForkUpdateSection";

const base: DesktopForkUpdateState = {
  enabled: true,
  head: "b405b9104f",
  branch: "feat/shared-history-continuation",
  paused: false,
  activeRuns: 0,
  applyRunning: false,
  check: {
    checkedAt: "2026-10-22T05:25:50Z",
    head: "b405b9104f",
    upstreamHead: "3b95e7831b",
    newCommits: 7,
    overlapFiles: ["apps/web/src/components/ChatView.tsx"],
    conflictFiles: [
      "apps/web/src/components/chat/ChatBannerLane.tsx",
      "apps/web/src/components/chat/ThreadErrorBanner.tsx",
    ],
    riskyFiles: ["packages/contracts/src/assets.ts"],
  },
  lastRun: null,
  error: null,
};

describe("forkUpdateBlockedReason", () => {
  it("allows an update when upstream moved and nothing is running", () => {
    expect(forkUpdateBlockedReason(base)).toBeNull();
  });

  it("blocks while an agent run is active", () => {
    expect(forkUpdateBlockedReason({ ...base, activeRuns: 2 })).toBe("2 agent runs are active.");
  });

  it("blocks when upstream has nothing new or was never checked", () => {
    expect(forkUpdateBlockedReason({ ...base, check: { ...base.check!, newCommits: 0 } })).toBe(
      "There is nothing new upstream.",
    );
    expect(forkUpdateBlockedReason({ ...base, check: null })).toBe(
      "There is nothing new upstream.",
    );
  });

  it("blocks while an update is already running", () => {
    expect(forkUpdateBlockedReason({ ...base, applyRunning: true })).toBe(
      "An update is already running.",
    );
  });
});

describe("describeForkUpdateCheck", () => {
  it("names the commits, the expected conflicts and the contract changes", () => {
    const text = describeForkUpdateCheck(base);
    expect(text).toContain("7 new upstream commits (upstream 3b95e7831b)");
    expect(text).toContain("conflicts in apps/web/src/components/chat/ChatBannerLane.tsx");
    expect(text).toContain("packages/contracts/src/assets.ts");
  });

  it("says when the fork is up to date", () => {
    expect(describeForkUpdateCheck({ ...base, check: { ...base.check!, newCommits: 0 } })).toMatch(
      /^Up to date with upstream main/,
    );
  });
});

describe("describeForkUpdateRun", () => {
  it("reports a failed run with its step and conflicts", () => {
    const text = describeForkUpdateRun({
      ...base,
      lastRun: {
        kind: "apply",
        startedAt: "2026-10-22T05:30:00Z",
        finishedAt: "2026-10-22T05:30:09Z",
        exitCode: 4,
        step: "rebase",
        message: "Rebase conflicts. Nothing changed.",
        conflictFiles: ["apps/web/src/components/chat/ChatBannerLane.tsx"],
        head: "b405b9104f",
      },
    });
    expect(text).toContain("apply failed at rebase (exit 4)");
    expect(text).toContain("Conflicts: apps/web/src/components/chat/ChatBannerLane.tsx.");
  });
});
