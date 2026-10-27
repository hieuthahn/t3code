import type { ProviderInstanceId, RunId, ServerProvider } from "@t3tools/contracts";

import { shortAccountLabels } from "./modelPickerAccountGroups";
import type { HandoffTimelineRun } from "./V2LifecycleRow";

const NOT_EXECUTED_STATUSES = new Set(["preparing", "queued", "cancelled", "rolled_back"]);

export interface AccountSwitchMarker {
  readonly fromLabel: string;
  readonly toLabel: string;
  readonly afterFailedRun: boolean;
}

/**
 * Name the account change that starts a run, when it moved between accounts sharing history.
 * Moves across groups are left to the context handoff row.
 */
export function resolveAccountSwitchMarker(input: {
  readonly runId: RunId | null;
  readonly runs: ReadonlyArray<HandoffTimelineRun>;
  readonly providers: ReadonlyArray<ServerProvider>;
}): AccountSwitchMarker | null {
  if (input.runId === null) return null;
  const run = input.runs.find((candidate) => candidate.id === input.runId);
  if (run === undefined) return null;
  let previous: HandoffTimelineRun | undefined;
  for (const candidate of input.runs) {
    if (candidate.ordinal >= run.ordinal || NOT_EXECUTED_STATUSES.has(candidate.status)) continue;
    if (previous === undefined || candidate.ordinal > previous.ordinal) previous = candidate;
  }
  if (previous === undefined || previous.providerInstanceId === run.providerInstanceId) return null;
  const find = (instanceId: ProviderInstanceId) =>
    input.providers.find((provider) => provider.instanceId === instanceId);
  const from = find(previous.providerInstanceId);
  const to = find(run.providerInstanceId);
  const groupKey = from?.continuation?.groupKey;
  if (
    from === undefined ||
    to === undefined ||
    groupKey === undefined ||
    from.driver !== to.driver ||
    to.continuation?.groupKey !== groupKey
  ) {
    return null;
  }
  return {
    fromLabel: from.displayName ?? from.instanceId,
    toLabel: to.displayName ?? to.instanceId,
    afterFailedRun: previous.status === "failed",
  };
}

/**
 * Name the account a run answered from, when several accounts share its history and a
 * reply could have come from any of them; null for a lone account.
 */
export function resolveRunAccountLabel(input: {
  readonly runId: RunId | null;
  readonly runs: ReadonlyArray<HandoffTimelineRun>;
  readonly providers: ReadonlyArray<ServerProvider>;
}): { readonly label: string; readonly name: string } | null {
  if (input.runId === null) return null;
  const run = input.runs.find((candidate) => candidate.id === input.runId);
  const account = input.providers.find(
    (provider) => provider.instanceId === run?.providerInstanceId,
  );
  const groupKey = account?.continuation?.groupKey;
  if (account === undefined || groupKey === undefined) return null;
  const members = input.providers.filter(
    (provider) =>
      provider.driver === account.driver && provider.continuation?.groupKey === groupKey,
  );
  if (members.length < 2) return null;
  const name = account.displayName ?? account.instanceId;
  const labels = shortAccountLabels(
    members.map((provider) => provider.displayName ?? provider.instanceId),
  );
  return { label: labels[members.indexOf(account)] ?? name, name };
}

const ACCOUNT_SWITCH_NOTICE_SUFFIX = ":signal:account-switch";

/**
 * Take the server's account switch notices out of the timeline, keyed by run, so their reason
 * reads in the switch divider instead of as a second row.
 */
export function splitAccountSwitchNotices<
  Entry extends {
    readonly id: string;
    readonly kind: string;
    readonly entry?: { readonly runId?: RunId | null; readonly label?: string };
  },
>(
  entries: ReadonlyArray<Entry>,
): { readonly entries: ReadonlyArray<Entry>; readonly reasons: ReadonlyMap<RunId, string> } {
  const reasons = new Map<RunId, string>();
  const kept = entries.filter((entry) => {
    const runId = entry.entry?.runId;
    if (entry.kind !== "work" || !entry.id.endsWith(ACCOUNT_SWITCH_NOTICE_SUFFIX) || !runId) {
      return true;
    }
    if (entry.entry?.label) reasons.set(runId, entry.entry.label);
    return false;
  });
  return reasons.size === 0 ? { entries, reasons } : { entries: kept, reasons };
}
