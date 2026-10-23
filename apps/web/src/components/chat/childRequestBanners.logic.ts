import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

/**
 * Each subagent waiting on an approval gets a banner answered in place, even while the
 * parent waits on the user too. Subagents with questions share one banner that opens them.
 */
export function planChildRequestBanners<
  T extends Pick<EnvironmentThreadShell, "hasPendingApprovals">,
>(input: {
  readonly childThreadInputs: ReadonlyArray<T>;
  readonly parentAwaitingUser: boolean;
}): { readonly approvals: ReadonlyArray<T>; readonly questions: ReadonlyArray<T> } {
  const approvals = input.childThreadInputs.filter((child) => child.hasPendingApprovals);
  const questions = input.parentAwaitingUser
    ? []
    : input.childThreadInputs.filter((child) => !child.hasPendingApprovals);
  return { approvals, questions };
}
