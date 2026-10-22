import type { ProviderInstanceId, RunId, ServerProvider } from "@t3tools/contracts";

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
