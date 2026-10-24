import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  DEFAULT_TEAM_LIMITS,
  EnvironmentId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  TEAM_SILENCE_LIMIT_MS,
  ThreadId,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadShell,
  type OrchestratorMcpTeamAssignment,
  type TeamSetup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import type { McpInvocationScope } from "../mcp/McpInvocationContext.ts";
import * as OrchestratorMcpService from "../mcp/OrchestratorMcpService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as TeamService from "./TeamService.ts";

const projectId = ProjectId.make("project:team");
const architectId = ThreadId.make("thread:architect");
const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claudeAgent");

const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:team"),
  requestNamespace: "provider-session:architect",
  thread: {
    threadId: architectId,
    providerSessionId: "session:architect",
    providerInstanceId: claude,
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

const team = (overrides: Partial<TeamSetup> = {}): TeamSetup => ({
  architect: { instanceId: claude, model: "claude-opus-4-1" },
  workers: [
    { instanceId: codex, model: "gpt-5-codex" },
    { instanceId: claude, model: "claude-sonnet-4-5" },
  ],
  limits: DEFAULT_TEAM_LIMITS,
  autonomous: true,
  ...overrides,
});

interface Fixture {
  readonly shells: Map<ThreadId, Partial<OrchestrationV2ThreadShell>>;
  readonly tasks: Map<string, Pick<OrchestrationV2Subagent, "status" | "result">>;
  readonly sequences: Map<ThreadId, number>;
  readonly delegated: Array<{ readonly clientRequestId: string; readonly task: string }>;
  readonly sent: Array<string>;
  readonly interrupted: Array<ThreadId>;
  readonly stopped: Array<ThreadId>;
  /** Each proposed task's key and the worker number the card shows. */
  readonly proposed: Array<{ readonly key: string; readonly worker: number | undefined }>;
  /** What the user picks on the card; null leaves it unanswered. */
  approve: ReadonlyArray<string> | null;
  /** What the user does on the team while the card shows. */
  duringCard: Effect.Effect<void> | null;
  /** The user picked before the card's caller could close it. */
  approvedBeforeClose: boolean;
  /** Why the card closed before a decision, if it did. */
  closedWith: string | undefined;
  readonly launches: Array<OrchestratorMcpService.ChildPlanLaunch>;
}

const makeFixture = (setup: TeamSetup = team()): Fixture => ({
  shells: new Map([
    [
      architectId,
      {
        id: architectId,
        projectId,
        team: setup,
        activeRunId: RunId.make("run:architect-1"),
        latestRunId: RunId.make("run:architect-1"),
        pendingRuntimeRequest: null,
      },
    ],
  ]),
  tasks: new Map(),
  sequences: new Map(),
  delegated: [],
  sent: [],
  interrupted: [],
  stopped: [],
  proposed: [],
  approve: null,
  duringCard: null,
  approvedBeforeClose: false,
  closedWith: undefined,
  launches: [],
});

const keyOf = (clientRequestId: string) => clientRequestId.split(":").at(-2)!;

const serviceLayer = TeamService.layerWith({ tickEvery: null });

const dependenciesFor = (fixture: Fixture) =>
  Layer.mergeAll(
    SqlitePersistence.layerMemory,
    NodeServices.layer,
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadShell: (threadId) =>
        Effect.sync(
          () => (fixture.shells.get(threadId) ?? null) as unknown as OrchestrationV2ThreadShell,
        ),
      getThreadRecords: () =>
        Effect.sync(
          () =>
            ({
              subagents: [...fixture.tasks].map(([key, task]) => ({
                id: NodeId.make(`node:${key}`),
                ...task,
              })),
            }) as never,
        ),
      sendToThread: (input) =>
        Effect.sync(() => {
          fixture.sent.push(input.text);
          return {} as never;
        }),
      interruptThread: (input) =>
        Effect.sync(() => {
          fixture.interrupted.push(input.threadId);
          return {} as never;
        }),
      stopDelegatedTasks: (input) =>
        Effect.sync(() => {
          fixture.stopped.push(input.threadId);
        }),
      getThreadEventSequence: (threadId) => Effect.sync(() => fixture.sequences.get(threadId) ?? 0),
    }),
    Layer.mock(OrchestratorMcpService.OrchestratorMcpService)({
      delegateTeamTask: (_scope, input) =>
        Effect.sync(() => {
          const key = keyOf(input.clientRequestId!);
          fixture.delegated.push({ clientRequestId: input.clientRequestId!, task: input.task });
          fixture.tasks.set(key, { status: "running", result: null });
          const childThreadId = ThreadId.make(`thread:${key}`);
          fixture.shells.set(childThreadId, {
            id: childThreadId,
            projectId,
            activeRunId: RunId.make(`run:${key}`),
            latestRunId: RunId.make(`run:${key}`),
            pendingRuntimeRequest: null,
          });
          return { taskId: NodeId.make(`node:${key}`), childThreadId } as never;
        }),
      askChildPlan: (_scope, input) =>
        Effect.gen(function* () {
          const keys = input.tasks.map((task) => task.key);
          fixture.proposed.push(
            ...input.tasks.map((task) => ({ key: task.key, worker: task.worker })),
          );
          if (fixture.duringCard !== null) yield* fixture.duringCard;
          if (!fixture.approvedBeforeClose && input.closeReason !== undefined) {
            fixture.closedWith = yield* input.closeReason;
          }
          const approve = fixture.closedWith === undefined ? fixture.approve : null;
          return {
            status:
              fixture.closedWith !== undefined
                ? "cancelled"
                : approve === null
                  ? "timed_out"
                  : "partially_approved",
            requestKey: "request",
            approvedKeys: keys.filter((key) => approve?.includes(key) ?? false),
            declinedKeys: keys.filter((key) => !(approve?.includes(key) ?? true)),
            children: [],
            recordLaunches: (launches) =>
              Effect.sync(() => {
                fixture.launches.push(...launches);
              }),
          };
        }),
    }),
  );

const work = (
  key: string,
  overrides: Partial<OrchestratorMcpTeamAssignment> = {},
): OrchestratorMcpTeamAssignment => ({
  key,
  title: `Do ${key}`,
  task: `Do the ${key} part.`,
  worker: 1,
  ...overrides,
});

const withTeam = <A, E>(
  fixture: Fixture,
  body: (service: TeamService.TeamService["Service"]) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  Effect.gen(function* () {
    return yield* body(yield* TeamService.TeamService);
  }).pipe(Effect.provide(serviceLayer.pipe(Layer.provideMerge(dependenciesFor(fixture)))));

const assign = (
  service: TeamService.TeamService["Service"],
  assignments: ReadonlyArray<OrchestratorMcpTeamAssignment>,
) => service.assign(scope, { reason: "Split the work.", assignments: [...assignments] });

const setArchitect = (fixture: Fixture, fields: Partial<OrchestrationV2ThreadShell>) =>
  fixture.shells.set(architectId, { ...fixture.shells.get(architectId), ...fields });

it.effect("starts what fits and says why the rest waits", () =>
  Effect.gen(function* () {
    const fixture = makeFixture();
    const result = yield* withTeam(fixture, (service) =>
      assign(service, [
        work("one"),
        work("two"),
        work("three"),
        work("review", { worker: 2, readOnly: true }),
      ]),
    );
    assert.deepEqual(
      result.started.map((started) => started.key),
      ["one", "two", "review"],
    );
    assert.deepEqual(result.waiting, [
      { key: "three", reason: "Waits for a free slot on codex, which runs 2 workers." },
    ]);
    assert.include(fixture.delegated[0]!.clientRequestId, ":one:1");
    assert.include(fixture.delegated[0]!.task, "under 2000 bytes");
  }),
);

it.effect("asks the user outside autonomous mode and queues only what they approve", () =>
  Effect.gen(function* () {
    const fixture = makeFixture(team({ autonomous: false }));
    fixture.approve = ["api"];
    const result = yield* withTeam(fixture, (service) =>
      assign(service, [work("api"), work("ui", { worker: 2 })]),
    );
    assert.equal(result.status, "queued");
    assert.deepEqual(result.declinedKeys, ["ui"]);
    assert.deepEqual(fixture.proposed, [
      { key: "api", worker: 1 },
      { key: "ui", worker: 2 },
    ]);
    assert.deepEqual(
      fixture.delegated.map((call) => keyOf(call.clientRequestId)),
      ["api"],
    );
  }),
);

it.effect("starts nothing when the user does not answer the card", () =>
  Effect.gen(function* () {
    const fixture = makeFixture(team({ autonomous: false }));
    const result = yield* withTeam(fixture, (service) => assign(service, [work("api")]));
    assert.equal(result.status, "timed_out");
    assert.deepEqual(fixture.delegated, []);
  }),
);

it.effect("closes the waiting card and starts nothing when the user stops the team", () =>
  Effect.gen(function* () {
    const fixture = makeFixture(team({ autonomous: false }));
    fixture.approve = ["api"];
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        fixture.duringCard = service.stop({ threadId: architectId }).pipe(Effect.orDie);
        const refused = yield* assign(service, [work("api")]).pipe(Effect.flip);
        assert.include(refused.message, "The user stopped the team.");
        assert.equal(fixture.closedWith, "The user stopped the team.");
        assert.deepEqual(fixture.delegated, []);
        assert.equal((yield* service.view(architectId))?.status, "stopped");
      }),
    );
  }),
);

it.effect("starts nothing the user approved just as the team stopped", () =>
  Effect.gen(function* () {
    const fixture = makeFixture(team({ autonomous: false }));
    fixture.approve = ["api"];
    fixture.approvedBeforeClose = true;
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        fixture.duringCard = service.stop({ threadId: architectId }).pipe(Effect.orDie);
        const refused = yield* assign(service, [work("api")]).pipe(Effect.flip);
        assert.include(refused.message, "The user stopped the team.");
        assert.deepEqual(fixture.delegated, []);
        assert.deepEqual(fixture.launches, [{ key: "api", failure: "The user stopped the team." }]);
        yield* service.tick;
        assert.deepEqual(fixture.delegated, []);
      }),
    );
  }),
);

it.effect("holds what the user approves while the team is paused until it resumes", () =>
  Effect.gen(function* () {
    const fixture = makeFixture(team({ autonomous: false }));
    fixture.approve = ["api"];
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        fixture.duringCard = service.pause({ threadId: architectId }).pipe(Effect.orDie);
        const result = yield* assign(service, [work("api")]);
        assert.equal(result.status, "queued");
        assert.deepEqual(result.started, []);
        assert.deepEqual(result.waiting, [
          { key: "api", reason: "Waits for the user to resume the team." },
        ]);
        yield* service.tick;
        assert.deepEqual(fixture.delegated, []);
        yield* service.resume({ threadId: architectId });
        yield* service.tick;
        assert.deepEqual(
          fixture.delegated.map((call) => keyOf(call.clientRequestId)),
          ["api"],
        );
      }),
    );
  }),
);

it.effect("starts a dependent once its dependency is done, during the architect's turn", () =>
  Effect.gen(function* () {
    const fixture = makeFixture();
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* assign(service, [work("api"), work("tests", { dependsOn: ["api"], worker: 2 })]);
        assert.deepEqual(
          fixture.delegated.map((call) => keyOf(call.clientRequestId)),
          ["api"],
        );
        fixture.tasks.set("api", { status: "completed", result: "Built it." });
        yield* service.tick;
        assert.deepEqual(
          fixture.delegated.map((call) => keyOf(call.clientRequestId)),
          ["api", "tests"],
        );
        const view = yield* service.view(architectId);
        assert.deepEqual(
          view?.assignments.map((assignment) => [assignment.key, assignment.status]),
          [
            ["api", "done"],
            ["tests", "running"],
          ],
        );
      }),
    );
  }),
);

it.effect("wakes an idle architect once to start queued work", () =>
  Effect.gen(function* () {
    const fixture = makeFixture();
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* assign(service, [work("api"), work("tests", { dependsOn: ["api"], worker: 2 })]);
        setArchitect(fixture, { activeRunId: null });
        fixture.tasks.set("api", { status: "completed", result: "Built it." });
        yield* service.tick;
        yield* service.tick;
        assert.lengthOf(fixture.sent, 1);
        assert.include(fixture.sent[0]!, "tests can start now");
        assert.lengthOf(fixture.delegated, 1);
      }),
    );
  }),
);

it.effect("continues the plan on the first stall and pauses with a report on the second", () =>
  Effect.gen(function* () {
    const fixture = makeFixture();
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* assign(service, [work("api")]);
        fixture.tasks.set("api", { status: "completed", result: "Built it." });
        setArchitect(fixture, { activeRunId: null });
        yield* service.tick;
        yield* service.tick;
        assert.lengthOf(fixture.sent, 1);
        assert.include(fixture.sent[0]!, "Continuing the plan");
        assert.include(fixture.sent[0]!, "no assignment is waiting to start");
        setArchitect(fixture, { latestRunId: RunId.make("run:architect-2") });
        yield* service.tick;
        const view = yield* service.view(architectId);
        assert.equal(view?.status, "paused");
        assert.include(view?.report ?? "", "stopped twice");
        assert.lengthOf(fixture.sent, 1);
      }),
    );
  }),
);

const insertMerge = (title: string, status: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO merge_queue_items ${sql.insert({
      item_id: `merge-queue:${title}`,
      project_id: projectId,
      trunk_ref: "main",
      owner_thread_id: architectId,
      owner_checkout: "/repo",
      child_thread_id: `thread:${title}`,
      child_title: title,
      child_branch: `t3/${title}`,
      child_worktree: `/worktrees/${title}`,
      head_sha_at_enqueue: "abc123",
      status,
      enqueued_at: "2026-10-24T00:00:00.000Z",
      updated_at: "2026-10-24T00:00:00.000Z",
    })}`;
  });

const setMergeStatus = (title: string, status: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE merge_queue_items SET status = ${status} WHERE item_id = ${`merge-queue:${title}`}`;
  });

/** The architect finished its round and idles while one of its merges waits for the user. */
const idleWithMergeWaiting = (service: TeamService.TeamService["Service"], fixture: Fixture) =>
  Effect.gen(function* () {
    yield* insertMerge("Landed earlier", "merged");
    yield* insertMerge("Add subtract", "awaiting_user");
    yield* assign(service, [work("api")]);
    fixture.tasks.set("api", { status: "completed", result: "Built it." });
    setArchitect(fixture, { activeRunId: null });
    yield* service.tick;
    yield* service.tick;
  });

it.effect("holds the team without a stall while a merge waits for the user or lands", () =>
  Effect.gen(function* () {
    const fixture = makeFixture();
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* idleWithMergeWaiting(service, fixture);
        yield* service.tick;
        yield* setMergeStatus("Add subtract", "gating");
        yield* service.tick;
        yield* service.tick;
        assert.deepEqual(fixture.sent, []);
        assert.equal((yield* service.view(architectId))?.status, "running");
      }),
    );
  }),
);

it.effect("wakes the architect once with the outcome when the waiting merge lands", () =>
  Effect.gen(function* () {
    const fixture = makeFixture();
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* idleWithMergeWaiting(service, fixture);
        yield* setMergeStatus("Add subtract", "merged");
        yield* service.tick;
        yield* service.tick;
        assert.lengthOf(fixture.sent, 1);
        assert.include(fixture.sent[0]!, "Add subtract merged");
        assert.notInclude(fixture.sent[0]!, "Landed earlier");
        assert.equal((yield* service.view(architectId))?.status, "running");
      }),
    );
  }),
);

it.effect("wakes the architect once with the outcome when the user removes the merge", () =>
  Effect.gen(function* () {
    const fixture = makeFixture();
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* idleWithMergeWaiting(service, fixture);
        yield* setMergeStatus("Add subtract", "cancelled");
        yield* service.tick;
        yield* service.tick;
        assert.lengthOf(fixture.sent, 1);
        assert.include(fixture.sent[0]!, "Add subtract removed by the user");
        assert.equal((yield* service.view(architectId))?.status, "running");
      }),
    );
  }),
);

it.effect("marks a failed worker and blocks what depends on it", () =>
  Effect.gen(function* () {
    const fixture = makeFixture();
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* assign(service, [work("api"), work("tests", { dependsOn: ["api"], worker: 2 })]);
        fixture.tasks.set("api", { status: "failed", result: "Tests failed: 2 of 9." });
        yield* service.tick;
        const view = yield* service.view(architectId);
        const [api, tests] = view?.assignments ?? [];
        assert.equal(api?.status, "failed");
        assert.equal(api?.failure, "Tests failed: 2 of 9.");
        assert.deepEqual(tests?.waitReason, { _tag: "dependency_failed", keys: ["api"] });
      }),
    );
  }),
);

it.effect("retries a failed key until its third attempt", () =>
  Effect.gen(function* () {
    const fixture = makeFixture();
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          yield* assign(service, [work("api")]);
          fixture.tasks.set("api", { status: "failed", result: "Broke." });
          yield* service.tick;
        }
        const refused = yield* assign(service, [work("api")]).pipe(Effect.flip);
        assert.include(refused.message, "already ran 3 times");
        assert.deepEqual(
          fixture.delegated.map((call) => call.clientRequestId.split(":").at(-1)),
          ["1", "2", "3"],
        );
      }),
    );
  }),
);

it.effect("stops a worker silent for 20 minutes unless it waits on the user", () =>
  Effect.gen(function* () {
    const fixture = makeFixture();
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* assign(service, [work("quiet"), work("asking", { worker: 2 })]);
        const asking = ThreadId.make("thread:asking");
        fixture.shells.set(asking, {
          ...fixture.shells.get(asking),
          pendingRuntimeRequest: {} as never,
        });
        yield* service.tick;
        fixture.sequences.set(architectId, 7);
        yield* TestClock.adjust(TEAM_SILENCE_LIMIT_MS);
        yield* service.tick;
        assert.deepEqual(fixture.interrupted, [ThreadId.make("thread:quiet")]);
      }),
    );
  }),
);

it.effect("refuses a round past the round limit", () =>
  Effect.gen(function* () {
    const fixture = makeFixture(team({ limits: { ...DEFAULT_TEAM_LIMITS, maxRounds: 1 } }));
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* assign(service, [work("api")]);
        const refused = yield* assign(service, [work("ui")]).pipe(Effect.flip);
        assert.include(refused.message, "used all 1 rounds");
      }),
    );
  }),
);

it.effect("pauses, resumes and stops the whole team", () =>
  Effect.gen(function* () {
    const fixture = makeFixture();
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* assign(service, [work("one"), work("two"), work("three")]);
        yield* service.pause({ threadId: architectId });
        const refused = yield* assign(service, [work("four")]).pipe(Effect.flip);
        assert.include(refused.message, "paused");
        fixture.tasks.set("one", { status: "completed", result: "Done." });
        yield* service.tick;
        assert.lengthOf(fixture.delegated, 2);
        setArchitect(fixture, { activeRunId: null });
        yield* service.resume({ threadId: architectId });
        assert.deepEqual(fixture.sent, [
          "The user resumed the team. Continue the plan from where it stopped.",
        ]);
        yield* service.stop({ threadId: architectId });
        assert.deepEqual(fixture.stopped, [architectId]);
        const view = yield* service.view(architectId);
        assert.equal(view?.status, "stopped");
        assert.deepEqual(
          view?.assignments.map((assignment) => assignment.status),
          ["done", "cancelled", "cancelled"],
        );
      }),
    );
  }),
);

it.effect("leaves a team interrupted after a restart until the user resumes it", () =>
  Effect.gen(function* () {
    const fixture = makeFixture();
    yield* Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const service = yield* TeamService.TeamService;
        yield* assign(service, [work("api")]);
      }).pipe(Effect.provide(serviceLayer));
      yield* Effect.gen(function* () {
        const service = yield* TeamService.TeamService;
        const view = yield* service.view(architectId);
        assert.equal(view?.status, "interrupted");
        fixture.tasks.set("api", { status: "interrupted", result: null });
        setArchitect(fixture, { activeRunId: null });
        yield* service.tick;
        assert.deepEqual(fixture.sent, []);
        yield* service.resume({ threadId: architectId });
        assert.lengthOf(fixture.sent, 1);
        assert.include(fixture.sent[0]!, "api stopped with the restart");
      }).pipe(Effect.provide(serviceLayer));
    }).pipe(Effect.provide(dependenciesFor(fixture)));
  }),
);

it.effect("finishes a team only once no worker runs", () =>
  Effect.gen(function* () {
    const fixture = makeFixture();
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* assign(service, [work("api")]);
        const refused = yield* service
          .finish(scope, { summary: "Shipped the API." })
          .pipe(Effect.flip);
        assert.include(refused.message, "api still run");
        fixture.tasks.set("api", { status: "completed", result: "Built it." });
        yield* service.tick;
        assert.deepEqual(yield* service.finish(scope, { summary: "Shipped the API." }), {
          status: "finished",
        });
        assert.equal((yield* service.view(architectId))?.summary, "Shipped the API.");
      }),
    );
  }),
);
