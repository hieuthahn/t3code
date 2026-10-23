import type {
  OrchestrationV2ChildReport,
  OrchestrationV2ChildReportClaim,
  OrchestrationV2ChildReportGitFacts,
} from "@t3tools/contracts";

export interface ChildReportView {
  readonly statusLabel: string;
  /** True when the child cannot go on without someone. */
  readonly attention: boolean;
  readonly headline: string;
  readonly summary: string;
  readonly observed: string;
}

const STATUS_LABELS: Record<OrchestrationV2ChildReportClaim["status"], string> = {
  working: "Working",
  blocked: "Blocked",
  needs_decision: "Needs decision",
  done: "Done",
  failed: "Failed",
};

/** Present a delegated child's latest report: its own claims first, then what git shows. */
export function childReportView(report: OrchestrationV2ChildReport): ChildReportView {
  const { claimed } = report;
  const statusLabel = STATUS_LABELS[claimed.status];
  return {
    statusLabel,
    attention:
      claimed.status === "blocked" ||
      claimed.status === "needs_decision" ||
      claimed.status === "failed",
    headline: [statusLabel, ...claimFacts(claimed)].join(" · "),
    summary: claimed.summary,
    observed: report.observed === null ? "No git repository" : observedFacts(report.observed),
  };
}

function claimFacts(claimed: OrchestrationV2ChildReportClaim): ReadonlyArray<string> {
  const questionsForUser = claimed.questions.filter((question) => question.audience === "user");
  const failed = claimed.tests.filter((test) => test.outcome === "failed").length;
  const passed = claimed.tests.filter((test) => test.outcome === "passed").length;
  return [
    ...(questionsForUser.length === 0
      ? []
      : [`${questionsForUser.length} question${questionsForUser.length === 1 ? "" : "s"} for you`]),
    ...(claimed.progress === undefined
      ? []
      : [`${claimed.progress.done}/${claimed.progress.total} ${claimed.progress.label}`]),
    ...(claimed.tests.length === 0
      ? []
      : [
          failed > 0
            ? `${failed} check${failed === 1 ? "" : "s"} failed`
            : `${passed} of ${claimed.tests.length} checks passed`,
        ]),
  ];
}

function observedFacts(observed: OrchestrationV2ChildReportGitFacts): string {
  const files = observed.filesChanged.length;
  return [
    observed.branch ?? "Detached HEAD",
    ...(observed.aheadBy === null || observed.behindBy === null || observed.baseRef === null
      ? []
      : [`${observed.aheadBy} ahead, ${observed.behindBy} behind ${observed.baseRef}`]),
    ...(files === 0
      ? []
      : [
          `${files}${observed.filesTruncated ? "+" : ""} file${files === 1 && !observed.filesTruncated ? "" : "s"} changed`,
        ]),
    ...(observed.dirty ? ["uncommitted changes"] : []),
  ].join(" · ");
}
