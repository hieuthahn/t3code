import type { OrchestratorMcpTarget, TeamMember, TeamSetup } from "@t3tools/contracts";
import * as Result from "effect/Result";

const describeWorkers = (workers: ReadonlyArray<TeamMember>) =>
  workers.map((worker) => `${worker.instanceId}:${worker.model}`).join(", ");

/**
 * The target a team's architect may delegate to: one of its workers, with that worker's options.
 * A thread outside a team keeps the target it asked for.
 */
export function resolveTeamTarget(
  team: TeamSetup | undefined,
  target: OrchestratorMcpTarget | undefined,
): Result.Result<OrchestratorMcpTarget | undefined, string> {
  if (team === undefined) return Result.succeed(target);
  const allowed = `This thread leads a team; delegate to one of its workers: ${describeWorkers(team.workers)}.`;
  if (target?.environmentId !== undefined) {
    return Result.fail(
      `${allowed} A team's workers run in this environment, so omit target.environmentId.`,
    );
  }
  if (target?.driverKind !== undefined && target.providerInstanceId === undefined) {
    return Result.fail(`${allowed} Name the worker by target.providerInstanceId and target.model.`);
  }
  const worker = team.workers.find(
    (candidate) =>
      (target?.providerInstanceId === undefined ||
        candidate.instanceId === target.providerInstanceId) &&
      (target?.model === undefined || candidate.model === target.model),
  );
  if (worker === undefined) return Result.fail(allowed);
  return Result.succeed({
    ...(target?.projectId === undefined ? {} : { projectId: target.projectId }),
    providerInstanceId: worker.instanceId,
    model: worker.model,
    options: worker.options ?? [],
  });
}
