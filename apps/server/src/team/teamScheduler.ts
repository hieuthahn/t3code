import {
  TEAM_MAX_ATTEMPTS,
  TEAM_PARALLEL_PER_ACCOUNT,
  type ProviderInstanceId,
  type TeamAssignmentIsolation,
  type TeamAssignmentStatus,
  type TeamLimits,
  type TeamUsage,
  type TeamWaitReason,
} from "@t3tools/contracts";

export interface ScheduledAssignment {
  readonly key: string;
  readonly status: TeamAssignmentStatus;
  readonly attempts: number;
  readonly instanceId: ProviderInstanceId;
  readonly dependsOn: ReadonlyArray<string>;
  readonly readOnly: boolean;
  readonly files: ReadonlyArray<string>;
  readonly isolation: TeamAssignmentIsolation;
}

export interface TeamPlan {
  readonly start: ReadonlyArray<string>;
  readonly waits: ReadonlyMap<string, TeamWaitReason>;
}

const normalizePath = (path: string) => path.replace(/^\.\//, "").replace(/\/+$/, "");

/** Two write scopes overlap when one path is the other or sits inside it; no paths is everything. */
export function writeScopesOverlap(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): ReadonlyArray<string> | null {
  if (left.length === 0) return right.length === 0 ? [] : right;
  if (right.length === 0) return left;
  const shared = left.flatMap((rawLeft) => {
    const a = normalizePath(rawLeft);
    return right.some((rawRight) => {
      const b = normalizePath(rawRight);
      return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`) || a === "" || b === "";
    })
      ? [rawLeft]
      : [];
  });
  return shared.length === 0 ? null : shared;
}

const sharesCheckoutForWriting = (assignment: ScheduledAssignment) =>
  !assignment.readOnly && assignment.isolation === "shared";

/** Pick the waiting assignments that start now and say what each of the others waits for. */
export function planTeamStarts(input: {
  readonly assignments: ReadonlyArray<ScheduledAssignment>;
  readonly maxParallel: TeamLimits["maxParallel"];
  readonly paused: boolean;
  readonly architectActive: boolean;
  readonly perAccount?: number;
}): TeamPlan {
  const perAccount = input.perAccount ?? TEAM_PARALLEL_PER_ACCOUNT;
  const byKey = new Map(input.assignments.map((assignment) => [assignment.key, assignment]));
  const running = input.assignments.filter((assignment) => assignment.status === "running");
  const start: Array<string> = [];
  const waits = new Map<string, TeamWaitReason>();
  const runningOn = (instanceId: ProviderInstanceId) =>
    running.filter((assignment) => assignment.instanceId === instanceId).length;

  for (const assignment of input.assignments) {
    if (assignment.status !== "waiting") continue;
    const failedDependencies = assignment.dependsOn.filter((key) => {
      const status = byKey.get(key)?.status;
      return status === "failed" || status === "cancelled";
    });
    if (failedDependencies.length > 0) {
      waits.set(assignment.key, { _tag: "dependency_failed", keys: failedDependencies });
      continue;
    }
    const unfinished = assignment.dependsOn.filter((key) => byKey.get(key)?.status !== "done");
    if (unfinished.length > 0) {
      waits.set(assignment.key, { _tag: "dependency", keys: unfinished });
      continue;
    }
    if (input.paused) {
      waits.set(assignment.key, { _tag: "team_paused" });
      continue;
    }
    if (input.maxParallel !== "unlimited" && running.length >= input.maxParallel) {
      waits.set(assignment.key, { _tag: "team_parallel", limit: input.maxParallel });
      continue;
    }
    const onAccount = runningOn(assignment.instanceId);
    if (onAccount >= perAccount) {
      waits.set(assignment.key, {
        _tag: "account_busy",
        instanceId: assignment.instanceId,
        running: onAccount,
      });
      continue;
    }
    if (sharesCheckoutForWriting(assignment)) {
      const blocker = running
        .filter(sharesCheckoutForWriting)
        .map((other) => ({ other, files: writeScopesOverlap(other.files, assignment.files) }))
        .find((candidate) => candidate.files !== null);
      if (blocker !== undefined) {
        waits.set(assignment.key, {
          _tag: "write_scope",
          key: blocker.other.key,
          files: blocker.files ?? [],
        });
        continue;
      }
    }
    if (!input.architectActive) {
      waits.set(assignment.key, { _tag: "next_turn" });
      continue;
    }
    start.push(assignment.key);
    running.push(assignment);
  }
  return { start, waits };
}

export interface NewAssignment {
  readonly key: string;
  readonly dependsOn: ReadonlyArray<string>;
}

/** Why a batch of new assignments cannot join the team; empty when it can. */
export function newAssignmentProblems(input: {
  readonly existing: ReadonlyArray<Pick<ScheduledAssignment, "key" | "status" | "attempts">>;
  readonly incoming: ReadonlyArray<NewAssignment>;
  readonly limits: TeamLimits;
  readonly usage: TeamUsage;
}): ReadonlyArray<string> {
  const problems: Array<string> = [];
  if (input.usage.rounds >= input.limits.maxRounds) {
    problems.push(
      `The team used all ${input.limits.maxRounds} rounds. Finish with team_finish, or ask the user to raise the limit.`,
    );
  }
  const existing = new Map(input.existing.map((assignment) => [assignment.key, assignment]));
  const seen = new Set<string>();
  let fresh = 0;
  for (const assignment of input.incoming) {
    if (seen.has(assignment.key)) {
      problems.push(`The batch lists ${assignment.key} twice. Give each assignment its own key.`);
      continue;
    }
    const previous = existing.get(assignment.key);
    if (previous === undefined) fresh += 1;
    else if (previous.status !== "failed" && previous.status !== "cancelled") {
      problems.push(`${assignment.key} is already ${previous.status}. Use a new key for new work.`);
    } else if (previous.attempts >= TEAM_MAX_ATTEMPTS) {
      problems.push(
        `${assignment.key} already ran ${TEAM_MAX_ATTEMPTS} times. Give it up or split it into new assignments.`,
      );
    }
    for (const dependency of assignment.dependsOn) {
      if (dependency === assignment.key) {
        problems.push(`${assignment.key} cannot depend on itself.`);
      } else if (!existing.has(dependency) && !seen.has(dependency)) {
        problems.push(
          `${assignment.key} depends on ${dependency}, which is neither on the team nor listed before it.`,
        );
      }
    }
    seen.add(assignment.key);
  }
  if (input.usage.assignments + fresh > input.limits.maxAssignments) {
    problems.push(
      `The batch adds ${fresh} assignments to the ${input.usage.assignments} made, over the limit of ${input.limits.maxAssignments}.`,
    );
  }
  return problems;
}
