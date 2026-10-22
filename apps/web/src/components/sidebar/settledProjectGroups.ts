import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

export interface SettledGroupProject {
  readonly key: string;
  readonly label: string;
  readonly workspaceRoot: string;
  readonly isScratch: boolean;
}

export interface SettledGroupTarget {
  readonly id: string;
  readonly label: string;
}

export interface SettledProjectGroup<T> extends SettledGroupTarget {
  readonly threads: readonly T[];
}

export const SCRATCH_SETTLED_GROUP: SettledGroupTarget = { id: "scratch", label: "Scratch" };
export const UNKNOWN_SETTLED_GROUP: SettledGroupTarget = { id: "unknown", label: "Other" };

const SCRATCH_WORKSPACES_SEGMENT = "scratch-workspaces";
const HOME_PARENT_SEGMENT = /^(Users|home)$/i;

function pathSegments(workspaceRoot: string): readonly string[] {
  return workspaceRoot.split(/[\\/]+/).filter(Boolean);
}

function isStrictPrefix(ancestor: readonly string[], descendant: readonly string[]): boolean {
  return (
    ancestor.length < descendant.length &&
    ancestor.every((segment, index) => segment === descendant[index])
  );
}

function isRootOrHome(segments: readonly string[]): boolean {
  return segments.length === 0 || (segments.length === 2 && HOME_PARENT_SEGMENT.test(segments[0]!));
}

/**
 * Map each project key to the group its settled threads show under.
 * A project folds into its nearest ancestor project unless that ancestor holds 2 or more subtrees.
 */
export function resolveSettledGroupTargets(
  projects: readonly SettledGroupProject[],
): ReadonlyMap<string, SettledGroupTarget> {
  const placed = projects.map((project) => ({
    project,
    segments: pathSegments(project.workspaceRoot),
  }));
  const isScratch = (entry: (typeof placed)[number]) =>
    entry.project.isScratch || entry.segments.includes(SCRATCH_WORKSPACES_SEGMENT);
  const candidates = placed.filter((entry) => !isScratch(entry));
  const isContainer = (entry: (typeof placed)[number]) => {
    if (isRootOrHome(entry.segments)) return true;
    const subtrees = new Set(
      candidates
        .filter((other) => isStrictPrefix(entry.segments, other.segments))
        .map((other) => other.segments[entry.segments.length]),
    );
    return subtrees.size >= 2;
  };
  const nearestAncestor = (entry: (typeof placed)[number]) =>
    candidates
      .filter((other) => isStrictPrefix(other.segments, entry.segments))
      .reduce<(typeof placed)[number] | undefined>(
        (deepest, other) =>
          deepest === undefined || other.segments.length > deepest.segments.length
            ? other
            : deepest,
        undefined,
      );
  const resolveRoot = (entry: (typeof placed)[number]): (typeof placed)[number] => {
    const ancestor = nearestAncestor(entry);
    return ancestor === undefined || isContainer(ancestor) ? entry : resolveRoot(ancestor);
  };
  return new Map(
    placed.map((entry) => {
      if (isScratch(entry)) return [entry.project.key, SCRATCH_SETTLED_GROUP] as const;
      const root = resolveRoot(entry).project;
      return [entry.project.key, { id: root.key, label: root.label }] as const;
    }),
  );
}

/** Return the latest user or run activity of a thread in epoch milliseconds. */
export function settledThreadActivityMs(
  thread: Pick<EnvironmentThreadShell, "latestUserMessageAt" | "latestRun" | "updatedAt">,
): number {
  const candidates = [
    thread.latestUserMessageAt,
    thread.latestRun?.requestedAt,
    thread.latestRun?.startedAt,
    thread.latestRun?.completedAt,
  ]
    .map((value) => (value == null ? Number.NaN : Date.parse(value)))
    .filter(Number.isFinite);
  if (candidates.length > 0) return Math.max(...candidates);
  const updatedMs = Date.parse(thread.updatedAt);
  return Number.isFinite(updatedMs) ? updatedMs : 0;
}

/** Group settled threads by folded project, most recently active group and thread first. */
export function groupSettledThreads<T>(input: {
  readonly threads: readonly T[];
  readonly targets: ReadonlyMap<string, SettledGroupTarget>;
  readonly projectKeyOf: (thread: T) => string;
  readonly activityMsOf: (thread: T) => number;
}): SettledProjectGroup<T>[] {
  const buckets = new Map<
    string,
    { target: SettledGroupTarget; entries: { thread: T; activityMs: number }[] }
  >();
  for (const thread of input.threads) {
    const target = input.targets.get(input.projectKeyOf(thread)) ?? UNKNOWN_SETTLED_GROUP;
    const bucket = buckets.get(target.id) ?? { target, entries: [] };
    bucket.entries.push({ thread, activityMs: input.activityMsOf(thread) });
    buckets.set(target.id, bucket);
  }
  return [...buckets.values()]
    .map(({ target, entries }) => {
      const sorted = entries.toSorted((left, right) => right.activityMs - left.activityMs);
      return { target, latestMs: sorted[0]!.activityMs, threads: sorted.map((e) => e.thread) };
    })
    .toSorted(
      (left, right) =>
        right.latestMs - left.latestMs || left.target.label.localeCompare(right.target.label),
    )
    .map(({ target, threads }) => ({ id: target.id, label: target.label, threads }));
}
