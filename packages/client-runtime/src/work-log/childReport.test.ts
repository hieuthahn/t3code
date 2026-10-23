import { describe, expect, it } from "vite-plus/test";

import type { OrchestrationV2ChildReport } from "@t3tools/contracts";

import { childReportView } from "./childReport.ts";

const report: OrchestrationV2ChildReport = {
  revision: 3,
  reportedAt: "2026-10-23T10:00:00.000Z",
  claimed: {
    status: "needs_decision",
    summary: "Built the banner.",
    progress: { done: 3, total: 5, label: "screens" },
    tests: [
      { command: "vp test run a.test.ts", outcome: "passed" },
      { command: "vp test run b.test.ts", outcome: "passed" },
      { command: "vp run lint", outcome: "not_run" },
    ],
    questions: [
      {
        id: "q1",
        question: "Keep the old banner?",
        options: [],
        allowCustom: true,
        audience: "user",
      },
      {
        id: "q2",
        question: "Which base?",
        options: [],
        allowCustom: true,
        audience: "parent",
      },
    ],
  },
  observed: {
    branch: "update/banner",
    headSha: "1111111111111111111111111111111111111111",
    baseRef: "feat/base",
    baseSha: "2222222222222222222222222222222222222222",
    aheadBy: 2,
    behindBy: 1,
    dirty: true,
    filesChanged: [
      { path: "a.ts", status: "M", additions: 1, deletions: 0 },
      { path: "b.ts", status: "A", additions: 4, deletions: 0 },
    ],
    filesTruncated: false,
  },
};

describe("childReportView", () => {
  it("leads with the status and counts the child's own claims", () => {
    expect(childReportView(report)).toEqual({
      statusLabel: "Needs decision",
      attention: true,
      headline: "Needs decision · 1 question for you · 3/5 screens · 2 of 3 checks passed",
      summary: "Built the banner.",
      observed:
        "update/banner · 2 ahead, 1 behind feat/base · 2 files changed · uncommitted changes",
    });
  });

  it("names failed checks and a cut file list", () => {
    const view = childReportView({
      ...report,
      claimed: {
        status: "done",
        summary: "Done.",
        tests: [{ command: "vp run typecheck", outcome: "failed" }],
        questions: [],
      },
      observed: { ...report.observed!, dirty: false, filesTruncated: true },
    });
    expect(view.attention).toBe(false);
    expect(view.headline).toBe("Done · 1 check failed");
    expect(view.observed).toBe("update/banner · 2 ahead, 1 behind feat/base · 2+ files changed");
  });

  it("says when the server found no git repository", () => {
    expect(childReportView({ ...report, observed: null }).observed).toBe("No git repository");
  });
});
