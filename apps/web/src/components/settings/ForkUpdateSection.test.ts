import type { DesktopForkUpdateState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  describeForkUpdateCheck,
  describeForkUpdateRun,
  forkBuildMatchesHead,
  forkUpdateBlockedReason,
} from "./ForkUpdateSection";

const base: DesktopForkUpdateState = {
  enabled: true,
  head: "b405b9104f",
  branch: "feat/shared-history-continuation",
  track: "preview",
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
    track: "preview",
    baseTag: "v0.1.1-preview.20261021.3449",
    targetTag: "v0.1.2-preview.20261022.3511",
    version: "0.1.1-preview.20261021.3449+fork.b405b9104f",
    updateAvailable: true,
    droppedCommits: 2,
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

  it("blocks when the fork is on the newest tag or was never checked", () => {
    expect(
      forkUpdateBlockedReason({ ...base, check: { ...base.check!, updateAvailable: false } }),
    ).toBe("There is no newer release to update to.");
    expect(forkUpdateBlockedReason({ ...base, check: null })).toBe(
      "There is no newer release to update to.",
    );
  });

  it("allows moving to an older tag, such as after switching to the stable track", () => {
    expect(
      forkUpdateBlockedReason({ ...base, check: { ...base.check!, newCommits: 0 } }),
    ).toBeNull();
  });

  it("blocks while an update is already running", () => {
    expect(forkUpdateBlockedReason({ ...base, applyRunning: true })).toBe(
      "An update is already running.",
    );
  });
});

describe("describeForkUpdateCheck", () => {
  it("names the target tag, the commits, the expected conflicts and the contract changes", () => {
    const text = describeForkUpdateCheck(base);
    expect(text).toContain(
      "v0.1.2-preview.20261022.3511 is available: 7 new upstream commits, 2 commits of the current base left out",
    );
    expect(text).toContain("conflicts in apps/web/src/components/chat/ChatBannerLane.tsx");
    expect(text).toContain("packages/contracts/src/assets.ts");
  });

  it("says when the fork is up to date", () => {
    expect(
      describeForkUpdateCheck({ ...base, check: { ...base.check!, updateAvailable: false } }),
    ).toMatch(/^Up to date with v0\.1\.2-preview\.20261022\.3511/);
  });

  it("reads a check written before tags were tracked", () => {
    const { checkedAt, head, upstreamHead, overlapFiles, conflictFiles, riskyFiles } = base.check!;
    const legacy = { checkedAt, head, upstreamHead, overlapFiles, conflictFiles, riskyFiles };
    expect(describeForkUpdateCheck({ ...base, check: { ...legacy, newCommits: 0 } })).toMatch(
      /^Up to date with upstream 3b95e7831b/,
    );
  });
});

describe("forkBuildMatchesHead", () => {
  it("matches the commit in the build version against the repo head", () => {
    expect(forkBuildMatchesHead("0.1.2-preview.20261022.3511+fork.468676ecbc", "468676ecbc")).toBe(
      true,
    );
    expect(forkBuildMatchesHead("0.1.2-preview.20261022.3511+fork.468676ecbc", "aa24fcc64b")).toBe(
      false,
    );
  });

  it("assumes a match for a build without a fork suffix", () => {
    expect(forkBuildMatchesHead("0.1.1", "468676ecbc")).toBe(true);
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
