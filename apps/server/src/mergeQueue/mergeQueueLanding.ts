import type {
  MergeQueueError,
  MergeQueueFailureStage,
  MergeQueueGateRun,
  ProjectScript,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";

import type * as ProjectService from "../project/ProjectService.ts";
import type * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { encodeGateRuns, tail, type MergeQueueRow } from "./mergeQueueRows.ts";

const GATE_TIMEOUT = "20 minutes";

export class GitStepFailure extends Schema.TaggedError<GitStepFailure>()("GitStepFailure", {
  message: Schema.String,
}) {}

export class StageFailure extends Schema.TaggedError<StageFailure>()("StageFailure", {
  stage: Schema.Literals(["head_moved", "update", "gate", "merge", "interrupted"]),
  message: Schema.String,
}) {}

/** Wrap the git driver so callers read trimmed stdout and fail with git's own message. */
export const makeMergeQueueGit = (driver: GitVcsDriver.GitVcsDriver["Service"]) => {
  const git = (cwd: string, args: ReadonlyArray<string>) =>
    driver.execute({
      operation: "MergeQueue.git",
      cwd,
      args,
      allowNonZeroExit: true,
      timeoutMs: 120_000,
    });
  const gitOutput = (cwd: string, args: ReadonlyArray<string>) =>
    git(cwd, args).pipe(
      Effect.flatMap((result) =>
        result.exitCode === 0
          ? Effect.succeed(result.stdout.trim())
          : Effect.fail(
              new GitStepFailure({ message: tail(`${result.stderr}${result.stdout}`).trim() }),
            ),
      ),
    );
  return { git, gitOutput };
};

export type MergeQueueGit = ReturnType<typeof makeMergeQueueGit>;

/** Build the steps that land one approved item, failing with the stage that stopped it. */
export const makeMergeQueueLanding = (deps: {
  readonly git: MergeQueueGit;
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly projects: ProjectService.ProjectService["Service"];
  readonly update: (
    row: MergeQueueRow,
    fields: Record<string, string | null>,
  ) => Effect.Effect<void, MergeQueueError>;
}) => {
  const { git, gitOutput } = deps.git;
  const { spawner, projects, update } = deps;

  const runGate = Effect.fn("MergeQueue.runGate")(function* (script: ProjectScript, cwd: string) {
    const startedAt = yield* Clock.currentTimeMillis;
    let output = "";
    const collect = (stream: Stream.Stream<Uint8Array, unknown>) =>
      stream.pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) =>
          Effect.sync(() => {
            output = tail(output + chunk);
          }),
        ),
        Effect.ignore,
      );
    const exitCode = yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner.spawn(
          ChildProcess.make("sh", ["-c", script.command], { cwd, stdin: "ignore" }),
        );
        yield* Effect.all([collect(child.stdout), collect(child.stderr)], {
          concurrency: "unbounded",
        });
        return Number(yield* child.exitCode);
      }),
    ).pipe(
      Effect.timeout(GATE_TIMEOUT),
      Effect.catch((cause) =>
        Effect.sync(() => {
          output = tail(`${output}\n${String(cause)}`);
          return null;
        }),
      ),
    );
    const finishedAt = yield* Clock.currentTimeMillis;
    return {
      name: script.name,
      command: script.command,
      exitCode,
      durationMs: finishedAt - startedAt,
      outputTail: output,
    } satisfies MergeQueueGateRun;
  });

  const land = Effect.fn("MergeQueue.land")(function* (queued: MergeQueueRow) {
    const stage = (name: MergeQueueFailureStage, message: string) =>
      new StageFailure({ stage: name, message });
    const lift = <A, E extends { readonly message: string }>(
      name: MergeQueueFailureStage,
      effect: Effect.Effect<A, E>,
    ) => effect.pipe(Effect.mapError((cause) => stage(name, cause.message)));

    yield* update(queued, { status: "updating" });
    const head = yield* lift(
      "head_moved",
      gitOutput(queued.child_worktree, ["rev-parse", `refs/heads/${queued.child_branch}`]),
    );
    if (head !== queued.head_sha_at_enqueue) {
      return yield* stage(
        "head_moved",
        `${queued.child_branch} moved from ${queued.head_sha_at_enqueue.slice(0, 7)} to ${head.slice(0, 7)} after it was approved. Queue it again to merge the new commits.`,
      );
    }
    const childCheckedOut = yield* lift(
      "update",
      gitOutput(queued.child_worktree, ["branch", "--show-current"]),
    );
    if (childCheckedOut !== queued.child_branch) {
      return yield* stage(
        "update",
        `The child's worktree has ${childCheckedOut.length === 0 ? "no branch" : childCheckedOut} checked out instead of ${queued.child_branch}.`,
      );
    }
    const dirty = yield* lift(
      "update",
      gitOutput(queued.child_worktree, ["status", "--porcelain"]),
    );
    if (dirty.length > 0) {
      return yield* stage(
        "update",
        "The child's worktree has uncommitted changes. Commit or discard them, then queue it again.",
      );
    }
    const trunkBefore = yield* lift(
      "update",
      gitOutput(queued.owner_checkout, ["rev-parse", `refs/heads/${queued.trunk_ref}`]),
    );
    yield* update(queued, { trunk_head_before: trunkBefore });
    const merge = yield* lift(
      "update",
      git(queued.child_worktree, ["merge", "--no-edit", queued.trunk_ref]),
    );
    if (merge.exitCode !== 0) {
      yield* git(queued.child_worktree, ["merge", "--abort"]).pipe(Effect.ignore);
      return yield* stage(
        "update",
        `Merging ${queued.trunk_ref} into ${queued.child_branch} hit a conflict:\n${tail(`${merge.stdout}${merge.stderr}`).trim()}`,
      );
    }

    const updatedHead = yield* lift(
      "update",
      gitOutput(queued.child_worktree, ["rev-parse", `refs/heads/${queued.child_branch}`]),
    );

    yield* update(queued, { status: "gating" });
    const project = yield* lift("gate", projects.getById(queued.project_id));
    const gates = Option.match(project, {
      onNone: () => [],
      onSome: (value) => value.scripts.filter((script) => script.runAsMergeGate === true),
    });
    const runs: Array<MergeQueueGateRun> = [];
    for (const script of gates) {
      const run = yield* runGate(script, queued.child_worktree);
      runs.push(run);
      yield* update(queued, { gate_runs_json: encodeGateRuns(runs) });
      if (run.exitCode !== 0) {
        return yield* stage(
          "gate",
          `The gate "${run.name}" (${run.command}) ${run.exitCode === null ? "did not finish" : `exited with ${run.exitCode}`}:\n${run.outputTail.trim()}`,
        );
      }
    }

    yield* update(queued, { status: "merging" });
    const landed = yield* lift(
      "head_moved",
      gitOutput(queued.child_worktree, ["rev-parse", `refs/heads/${queued.child_branch}`]),
    );
    if (landed !== updatedHead) {
      return yield* stage(
        "head_moved",
        `${queued.child_branch} got new commits while the gates ran. Queue it again to merge them.`,
      );
    }
    const trunkNow = yield* lift(
      "merge",
      gitOutput(queued.owner_checkout, ["rev-parse", `refs/heads/${queued.trunk_ref}`]),
    );
    if (trunkNow !== trunkBefore) {
      return yield* stage(
        "merge",
        `${queued.trunk_ref} moved while the gates ran. Queue the child again.`,
      );
    }
    const ownerBranch = yield* lift(
      "merge",
      gitOutput(queued.owner_checkout, ["branch", "--show-current"]),
    );
    if (ownerBranch === queued.trunk_ref) {
      const ownerDirty = yield* lift(
        "merge",
        gitOutput(queued.owner_checkout, ["status", "--porcelain", "--untracked-files=no"]),
      );
      if (ownerDirty.length > 0) {
        return yield* stage(
          "merge",
          `The checkout of ${queued.trunk_ref} has uncommitted changes, so the queue left it alone.`,
        );
      }
      yield* lift("merge", gitOutput(queued.owner_checkout, ["merge", "--ff-only", landed]));
    } else {
      yield* lift(
        "merge",
        gitOutput(queued.owner_checkout, [
          "update-ref",
          `refs/heads/${queued.trunk_ref}`,
          landed,
          trunkBefore,
        ]),
      );
    }
    yield* update(queued, { status: "merged", merged_sha: landed });
  });

  return land;
};
