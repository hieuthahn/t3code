import {
  CommandId,
  MergeQueueError,
  MergeQueueItemId,
  MessageId,
  type MergeQueueApproveInput,
  type MergeQueueCancelInput,
  type MergeQueueItem,
  type MergeQueueTrunk,
  type MergeQueueView,
  type OrchestrationV2RuntimeRequestDecider,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { ChildProcessSpawner } from "effect/process";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import {
  makeMergeQueueGit,
  makeMergeQueueLanding,
  resolveMergeGates,
  StageFailure,
} from "./mergeQueueLanding.ts";
import {
  ACTIVE_STATUSES,
  RUNNING_STATUSES,
  decodeRows,
  encodeDecider,
  encodeFailure,
  itemFromRow,
  type MergeQueueRow,
} from "./mergeQueueRows.ts";
import { makeItemTransition } from "./mergeQueueTransition.ts";

export type { MergeQueueItem };

const squashedMessage = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : String(error);
};

export class MergeQueueService extends Context.Service<
  MergeQueueService,
  {
    /** Queue a child's branch for the trunk its parent works on; the user approves it next. */
    readonly enqueue: (input: {
      readonly callerThreadId: ThreadId;
      readonly childThreadId: ThreadId;
    }) => Effect.Effect<MergeQueueItem, MergeQueueError>;
    readonly approve: (
      input: MergeQueueApproveInput,
      decidedBy: OrchestrationV2RuntimeRequestDecider,
    ) => Effect.Effect<void, MergeQueueError>;
    readonly cancel: (input: MergeQueueCancelInput) => Effect.Effect<void, MergeQueueError>;
    readonly view: (ownerThreadId: ThreadId) => Effect.Effect<MergeQueueView, MergeQueueError>;
    readonly subscribe: (ownerThreadId: ThreadId) => Stream.Stream<MergeQueueView, MergeQueueError>;
    /** Land every approved item, one at a time, and return once none is left. */
    readonly drain: Effect.Effect<void>;
  }
>()("t3/mergeQueue/MergeQueueService") {}

/** Build the queue; tests turn off `drainOnApprove` to decide when items land. */
export const layerWith = (options: { readonly drainOnApprove: boolean }) =>
  Layer.effect(
    MergeQueueService,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const mergeQueueGit = makeMergeQueueGit(yield* GitVcsDriver.GitVcsDriver);
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const crypto = yield* Crypto.Crypto;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const projects = yield* ProjectService.ProjectService;
      const settings = yield* ServerSettings.ServerSettingsService;
      const threads = yield* ThreadManagementService.ThreadManagementService;
      const changes = yield* PubSub.unbounded<ThreadId>();
      const landing = yield* Semaphore.make(1);
      const scope = yield* Effect.scope;

      const queueError = (message: string, itemId?: MergeQueueItemId) => (cause: unknown) =>
        new MergeQueueError({ message, ...(itemId === undefined ? {} : { itemId }), cause });
      const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

      const { git, gitOutput } = mergeQueueGit;
      const readRows = (query: Effect.Effect<ReadonlyArray<unknown>, SqlError>) =>
        query.pipe(
          Effect.flatMap(decodeRows),
          Effect.mapError(queueError("Could not read the merge queue.")),
        );
      const readItem = (itemId: MergeQueueItemId) =>
        readRows(sql`SELECT * FROM merge_queue_items WHERE item_id = ${itemId}`).pipe(
          Effect.flatMap((rows) =>
            rows[0] === undefined
              ? Effect.fail(
                  new MergeQueueError({ message: "This merge queue item does not exist.", itemId }),
                )
              : Effect.succeed(rows[0]),
          ),
        );
      const update = Effect.fn("MergeQueue.update")(function* (
        row: MergeQueueRow,
        fields: Record<string, string | null>,
      ) {
        yield* sql`UPDATE merge_queue_items SET ${sql.update({ ...fields, updated_at: yield* now })}
          WHERE item_id = ${row.item_id}`.pipe(
          Effect.mapError(queueError("Could not update the merge queue.", row.item_id)),
        );
        yield* PubSub.publish(changes, row.owner_thread_id);
      });

      const transition = makeItemTransition(sql);
      const moveItem = Effect.fn("MergeQueue.moveItem")(function* (
        row: MergeQueueRow,
        from: ReadonlyArray<MergeQueueRow["status"]>,
        fields: Record<string, string | null>,
      ) {
        const moved = yield* transition(row.item_id, from, fields, yield* now).pipe(
          Effect.mapError(queueError("Could not update the merge queue.", row.item_id)),
        );
        if (moved) yield* PubSub.publish(changes, row.owner_thread_id);
        return moved;
      });

      const readShell = (threadId: ThreadId) =>
        projections
          .getThreadShell(threadId)
          .pipe(Effect.mapError(queueError("Could not read the thread for the merge queue.")));
      const requireMergeGates = Effect.fn("MergeQueue.requireMergeGates")(function* (
        projectId: ProjectId,
        itemId?: MergeQueueItemId,
      ) {
        const gates = yield* resolveMergeGates(projects, settings, projectId).pipe(
          Effect.mapError(queueError("Could not read the project's merge gates.", itemId)),
        );
        if (gates.length === 0) {
          return yield* new MergeQueueError({
            message:
              "This project has no merge gate, so the queue cannot check the child before landing it. Mark a project script as a merge gate in the project's settings first.",
            ...(itemId === undefined ? {} : { itemId }),
          });
        }
      });

      const enqueue: MergeQueueService["Service"]["enqueue"] = Effect.fn("MergeQueue.enqueue")(
        function* (input) {
          const child = yield* readShell(input.childThreadId);
          if (child === null || child.lineage.parentThreadId !== input.callerThreadId) {
            return yield* new MergeQueueError({
              message: "Only the thread that started this child session can queue it for merging.",
            });
          }
          if (child.branch === null || child.worktreePath === null) {
            return yield* new MergeQueueError({
              message:
                "This child session has no branch of its own. Start it with worktree isolation to merge it.",
            });
          }
          const owner = yield* readShell(input.callerThreadId);
          const project = yield* projects
            .getById(child.projectId)
            .pipe(Effect.mapError(queueError("Could not read the project.")));
          if (owner === null || Option.isNone(project)) {
            return yield* new MergeQueueError({
              message: "The parent thread or its project is gone.",
            });
          }
          yield* requireMergeGates(child.projectId);
          const ownerCheckout = owner.worktreePath ?? project.value.workspaceRoot;
          const trunkRef =
            owner.branch ??
            (yield* gitOutput(ownerCheckout, ["branch", "--show-current"]).pipe(
              Effect.mapError(queueError("Could not read the parent's branch.")),
            ));
          if (trunkRef.length === 0) {
            return yield* new MergeQueueError({
              message:
                "The parent's checkout has no branch checked out, so there is no trunk to merge into.",
            });
          }
          const headSha = yield* gitOutput(child.worktreePath, [
            "rev-parse",
            `refs/heads/${child.branch}`,
          ]).pipe(Effect.mapError(queueError("Could not read the child's branch.")));
          const alreadyIn = yield* git(ownerCheckout, [
            "merge-base",
            "--is-ancestor",
            headSha,
            `refs/heads/${trunkRef}`,
          ]).pipe(Effect.mapError(queueError("Could not compare the child with the trunk.")));
          if (alreadyIn.exitCode === 0) {
            return yield* new MergeQueueError({
              message: `${child.branch} has nothing that ${trunkRef} does not already have.`,
            });
          }
          const active = yield* readRows(
            sql`SELECT * FROM merge_queue_items WHERE child_thread_id = ${child.id}
            AND status IN ${sql.in(ACTIVE_STATUSES)}`,
          );
          const waiting = active.find((row) => row.status === "awaiting_user");
          if (waiting !== undefined) {
            yield* update(waiting, { head_sha_at_enqueue: headSha });
            return itemFromRow(yield* readItem(waiting.item_id));
          }
          if (active.length > 0) {
            return yield* new MergeQueueError({
              message: "This child session is already in the merge queue.",
              itemId: active[0]!.item_id,
            });
          }
          const itemId = MergeQueueItemId.make(
            `merge-queue:${yield* crypto.randomUUIDv4().pipe(Effect.orDie)}`,
          );
          const at = yield* now;
          yield* sql`INSERT INTO merge_queue_items ${sql.insert({
            item_id: itemId,
            project_id: child.projectId,
            trunk_ref: trunkRef,
            owner_thread_id: owner.id,
            owner_checkout: ownerCheckout,
            child_thread_id: child.id,
            child_title: child.title,
            child_branch: child.branch,
            child_worktree: child.worktreePath,
            head_sha_at_enqueue: headSha,
            status: "awaiting_user",
            gate_runs_json: "[]",
            enqueued_at: at,
            updated_at: at,
          })}`.pipe(Effect.mapError(queueError("Could not add the child to the merge queue.")));
          yield* PubSub.publish(changes, owner.id);
          return itemFromRow(yield* readItem(itemId));
        },
      );

      const tellChild = (row: MergeQueueRow, text: string) =>
        threads
          .sendToThread({
            projectId: row.project_id,
            commandId: CommandId.make(`${row.item_id}:failed:${row.updated_at}`),
            threadId: row.child_thread_id,
            messageId: MessageId.make(`message:${row.item_id}:failed:${row.updated_at}`),
            text,
            attachments: [],
            mode: "auto",
            createdBy: "system",
            creationSource: "server",
          })
          .pipe(
            Effect.asVoid,
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not tell a child session why its merge failed", { cause }),
            ),
          );

      const land = makeMergeQueueLanding({
        git: mergeQueueGit,
        spawner,
        projects,
        settings,
        update,
        childIsRunning: (threadId) =>
          readShell(threadId).pipe(
            Effect.map((shell) => shell !== null && shell.activeRunId !== null),
          ),
        claim: (row) => moveItem(row, ["queued"], { status: "updating" }),
      });

      const failItem = Effect.fn("MergeQueue.failItem")(function* (
        row: MergeQueueRow,
        failure: StageFailure,
      ) {
        yield* update(yield* readItem(row.item_id), {
          status: "failed",
          failure_json: encodeFailure({ stage: failure.stage, message: failure.message }),
        });
        if (failure.stage !== "interrupted" && failure.stage !== "error") {
          yield* tellChild(
            yield* readItem(row.item_id),
            `The merge queue did not land ${row.child_branch} on ${row.trunk_ref}. ${failure.message}`,
          );
        }
      });

      /** Land one item; any failure but an interruption fails that item so the rest still land. */
      const landOne = (row: MergeQueueRow) =>
        land(row).pipe(
          Effect.catchTag("StageFailure", (failure) => Effect.succeed(failure)),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.succeed(
                  new StageFailure({
                    stage: "error",
                    message: `The merge queue hit an unexpected error: ${squashedMessage(cause)}`,
                  }),
                ),
          ),
          Effect.flatMap((failure) =>
            failure === undefined ? Effect.void : failItem(row, failure),
          ),
        );

      const nextQueued = readRows(
        sql`SELECT * FROM merge_queue_items WHERE status = 'queued' ORDER BY updated_at, enqueued_at LIMIT 1`,
      );
      const drain: MergeQueueService["Service"]["drain"] = landing.withPermits(1)(
        Effect.gen(function* () {
          while (true) {
            const rows = yield* nextQueued;
            const row = rows[0];
            if (row === undefined) return;
            yield* landOne(row);
          }
        }).pipe(
          Effect.catchCause((cause) => Effect.logError("The merge queue stopped", { cause })),
        ),
      );

      const approve: MergeQueueService["Service"]["approve"] = Effect.fn("MergeQueue.approve")(
        function* (input, decidedBy) {
          const row = yield* readItem(input.itemId);
          if (row.status !== "awaiting_user") {
            return yield* new MergeQueueError({
              message: "This item is not waiting for approval.",
              itemId: row.item_id,
            });
          }
          if (row.head_sha_at_enqueue !== input.headSha) {
            return yield* new MergeQueueError({
              message: "The child pushed new commits after this was shown. Review it again.",
              itemId: row.item_id,
            });
          }
          yield* requireMergeGates(row.project_id, row.item_id);
          const queued = yield* moveItem(row, ["awaiting_user"], {
            status: "queued",
            approved_by_json: encodeDecider(decidedBy),
          });
          if (!queued) {
            return yield* new MergeQueueError({
              message: "This item is not waiting for approval.",
              itemId: row.item_id,
            });
          }
          if (options.drainOnApprove) {
            yield* Effect.forkIn(drain, scope);
          }
        },
      );

      const cancel: MergeQueueService["Service"]["cancel"] = Effect.fn("MergeQueue.cancel")(
        function* (input) {
          const row = yield* readItem(input.itemId);
          if (
            !(yield* moveItem(row, ["awaiting_user", "queued", "failed"], { status: "cancelled" }))
          ) {
            return yield* new MergeQueueError({
              message: "This item already ran.",
              itemId: row.item_id,
            });
          }
        },
      );

      const view: MergeQueueService["Service"]["view"] = Effect.fn("MergeQueue.view")(
        function* (ownerThreadId) {
          const rows = yield* readRows(
            sql`SELECT * FROM merge_queue_items WHERE owner_thread_id = ${ownerThreadId} ORDER BY enqueued_at`,
          );
          const trunkKeys = [...new Set(rows.map((row) => row.trunk_ref))];
          const trunks: Array<MergeQueueTrunk> = [];
          for (const trunkRef of trunkKeys) {
            const ofTrunk = rows.filter((row) => row.trunk_ref === trunkRef);
            const lastMerged = ofTrunk
              .filter((row) => row.status === "merged")
              .toSorted((left, right) => left.updated_at.localeCompare(right.updated_at))
              .at(-1);
            const running = ofTrunk.some((row) =>
              (RUNNING_STATUSES as ReadonlyArray<string>).includes(row.status),
            );
            const head = yield* gitOutput(ofTrunk[0]!.owner_checkout, [
              "rev-parse",
              `refs/heads/${trunkRef}`,
            ]).pipe(Effect.option, Effect.map(Option.getOrNull));
            trunks.push({
              trunkRef,
              head,
              movedOutsideQueue:
                lastMerged !== undefined &&
                !running &&
                head !== null &&
                head !== lastMerged.merged_sha,
            });
          }
          return { ownerThreadId, trunks, items: rows.map(itemFromRow) };
        },
      );

      const subscribe: MergeQueueService["Service"]["subscribe"] = (ownerThreadId) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(changes);
            return Stream.concat(
              Stream.fromEffect(view(ownerThreadId)),
              Stream.fromSubscription(subscription).pipe(
                Stream.filter((changed) => changed === ownerThreadId),
                Stream.mapEffect(() => view(ownerThreadId)),
              ),
            );
          }),
        );

      const interrupted = yield* readRows(
        sql`SELECT * FROM merge_queue_items WHERE status IN ${sql.in(RUNNING_STATUSES)}`,
      ).pipe(Effect.orElseSucceed(() => []));
      for (const row of interrupted) {
        yield* update(row, {
          status: "failed",
          failure_json: encodeFailure({
            stage: "interrupted",
            message: "The server restarted while this item ran. Queue it again.",
          }),
        }).pipe(Effect.ignore);
      }
      yield* Effect.forkIn(drain, scope);

      return MergeQueueService.of({ enqueue, approve, cancel, view, subscribe, drain });
    }),
  );

export const layer = layerWith({ drainOnApprove: true });
