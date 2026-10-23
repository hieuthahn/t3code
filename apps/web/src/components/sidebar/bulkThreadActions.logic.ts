export type BulkThreadActionId =
  | "settle"
  | "unsettle"
  | "pin"
  | "unpin"
  | "snooze"
  | "archive"
  | "mark-unread"
  | "delete";

export interface BulkThreadCandidate {
  readonly threadKey: string;
  readonly settled: boolean;
  readonly pinned: boolean;
  readonly canPin: boolean;
  readonly canSnooze: boolean;
}

export interface BulkThreadActionPlan {
  readonly id: BulkThreadActionId;
  readonly targetKeys: readonly string[];
}

/**
 * Plan every bulk action for a selection, keeping only the threads each action would change.
 */
export function planBulkThreadActions(
  candidates: readonly BulkThreadCandidate[],
): ReadonlyMap<BulkThreadActionId, BulkThreadActionPlan> {
  const keysWhere = (predicate: (candidate: BulkThreadCandidate) => boolean) =>
    candidates.filter(predicate).map((candidate) => candidate.threadKey);
  const allKeys = candidates.map((candidate) => candidate.threadKey);
  const snoozeKeys = candidates.every((candidate) => candidate.canSnooze) ? allKeys : [];
  const entries: readonly BulkThreadActionPlan[] = [
    { id: "settle", targetKeys: keysWhere((candidate) => !candidate.settled) },
    { id: "unsettle", targetKeys: keysWhere((candidate) => candidate.settled) },
    { id: "pin", targetKeys: keysWhere((candidate) => candidate.canPin && !candidate.pinned) },
    { id: "unpin", targetKeys: keysWhere((candidate) => candidate.canPin && candidate.pinned) },
    { id: "snooze", targetKeys: snoozeKeys },
    { id: "archive", targetKeys: allKeys },
    { id: "mark-unread", targetKeys: allKeys },
    { id: "delete", targetKeys: allKeys },
  ];
  return new Map(entries.map((plan) => [plan.id, plan]));
}

/**
 * Pick the one toggle a bar shows for a pair of opposite actions, by which side holds more threads.
 */
export function pickBulkToggle<T extends BulkThreadActionId>(
  plans: ReadonlyMap<BulkThreadActionId, BulkThreadActionPlan>,
  forward: T,
  backward: T,
): T | null {
  const forwardCount = plans.get(forward)?.targetKeys.length ?? 0;
  const backwardCount = plans.get(backward)?.targetKeys.length ?? 0;
  if (forwardCount === 0 && backwardCount === 0) return null;
  return forwardCount >= backwardCount ? forward : backward;
}

export type BulkRunResult = { readonly _tag: "Success" } | { readonly _tag: "Failure" };

export interface BulkRunOutcome<TTarget> {
  readonly succeeded: readonly TTarget[];
  readonly failed: readonly { readonly target: TTarget; readonly error: unknown }[];
  readonly interrupted: readonly TTarget[];
}

/**
 * Run one command per target with bounded concurrency, sorting each result into an outcome bucket.
 */
export async function runBulkThreadAction<TTarget, TResult extends BulkRunResult>(input: {
  readonly targets: readonly TTarget[];
  readonly execute: (target: TTarget) => Promise<TResult>;
  readonly isInterrupted: (result: TResult) => boolean;
  readonly describeFailure: (result: TResult) => unknown;
  readonly concurrency?: number;
}): Promise<BulkRunOutcome<TTarget>> {
  const succeeded: TTarget[] = [];
  const failed: { target: TTarget; error: unknown }[] = [];
  const interrupted: TTarget[] = [];
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < input.targets.length) {
      const target = input.targets[nextIndex++] as TTarget;
      try {
        const result = await input.execute(target);
        if (result._tag === "Success") succeeded.push(target);
        else if (input.isInterrupted(result)) interrupted.push(target);
        else failed.push({ target, error: input.describeFailure(result) });
      } catch (error) {
        failed.push({ target, error });
      }
    }
  };
  const workerCount = Math.max(1, Math.min(input.concurrency ?? 4, input.targets.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return { succeeded, failed, interrupted };
}

const BULK_ACTION_VERBS: Record<BulkThreadActionId, string> = {
  settle: "settle",
  unsettle: "un-settle",
  pin: "pin",
  unpin: "unpin",
  snooze: "snooze",
  archive: "archive",
  "mark-unread": "mark unread",
  delete: "delete",
};

/**
 * Title the single error toast for a bulk run, or return null when nothing failed.
 */
export function describeBulkFailure(
  action: BulkThreadActionId,
  outcome: Pick<BulkRunOutcome<unknown>, "succeeded" | "failed">,
): string | null {
  const failedCount = outcome.failed.length;
  if (failedCount === 0) return null;
  const total = failedCount + outcome.succeeded.length;
  return `Failed to ${BULK_ACTION_VERBS[action]} ${failedCount} of ${total} thread${total === 1 ? "" : "s"}`;
}
