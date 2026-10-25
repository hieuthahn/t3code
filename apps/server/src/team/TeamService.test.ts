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
  AuthSessionId,
  TurnItemId,
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
import type { TeamCard } from "./teamCards.ts";
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
  /** The team's cards, as the thread records them. */
  readonly cards: Array<TeamCard>;
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
  cards: [],
});

/** The user's click on the newest card still waiting. */
const decide = (
  fixture: Fixture,
  approved: ReadonlyArray<string>,
  index = fixture.cards.findLastIndex((card) => card.planStatus === "pending"),
) => {
  const card = fixture.cards[index]!;
  const keys = card.children.map((child) => child.key);
  const approvedKeys = keys.filter((key) => approved.includes(key));
  const declinedKeys = keys.filter((key) => !approved.includes(key));
  fixture.cards[index] = {
    ...card,
    status: "completed",
    planStatus:
      approvedKeys.length === 0
        ? "declined"
        : declinedKeys.length === 0
          ? "approved"
          : "partially_approved",
    planDecision: {
      decidedBy: { actor: "user", authSessionId: AuthSessionId.make("session:web") },
      revision: 1,
      approvedKeys,
      declinedKeys,
    },
  };
};

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
              turnItems: [...fixture.cards],
            }) as never,
        ),
      dispatch: (command) =>
        Effect.sync(() => {
          const index = fixture.cards.findIndex(
            (card) => "turnItemId" in command && card.id === command.turnItemId,
          );
          const card = fixture.cards[index];
          if (card !== undefined && command.type === "child_plan.record") {
            fixture.cards[index] = {
              ...card,
              status: "cancelled",
              planStatus: command.planStatus,
              ...(command.closedReason === undefined ? {} : { closedReason: command.closedReason }),
            };
          }
          if (card !== undefined && command.type === "child_plan.launched") {
            fixture.cards[index] = { ...card, launches: command.launches };
          }
          return {} as never;
        }),
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
      openChildPlan: (_scope, input) =>
        Effect.sync(() => {
          fixture.proposed.push(
            ...input.tasks.map((task) => ({ key: task.key, worker: task.worker })),
          );
          const id = TurnItemId.make(`card:${fixture.cards.length + 1}`);
          fixture.cards.push({
            id,
            type: "child_plan_request",
            threadId: architectId,
            runId: RunId.make("run:architect-1"),
            nodeId: NodeId.make("node:architect-1"),
            planId: `child-plan:${encodeURIComponent(architectId)}:${encodeURIComponent(
              `${input.clientRequestId!}#${fixture.cards.length + 1}`,
            )}`,
            status: "waiting",
            revision: 1,
            planStatus: "pending",
            waitsAfterRun: true,
            planDecision: null,
            children: input.tasks.map((task) => ({
              key: task.key,
              title: task.title,
              brief: task.task,
              ...(task.worker === undefined ? {} : { worker: task.worker }),
              isolation: task.isolation ?? "shared",
              modelSelection: {
                instanceId: task.target!.providerInstanceId!,
                model: task.target!.model!,
                options: [...(task.target!.options ?? [])],
              },
              ...(task.dependsOn === undefined ? {} : { dependsOn: task.dependsOn }),
              ...(task.readOnly === undefined ? {} : { readOnly: task.readOnly }),
              ...(task.files === undefined ? {} : { files: task.files }),
            })),
          } as unknown as TeamCard);
          return { turnItemId: id };
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

const keysDelegated = (fixture: Fixture) =>
  fixture.delegated.map((call) => keyOf(call.clientRequestId));

it.effect("returns at once outside autonomous mode and starts what the user approves later", () =>
  Effect.gen(function* () {
    const fixture = makeFixture(team({ autonomous: false }));
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        const result = yield* assign(service, [work("api"), work("ui", { worker: 2 })]);
        assert.equal(result.status, "proposed");
        assert.equal(result.turnItemId, "card:1");
        assert.deepEqual(fixture.proposed, [
          { key: "api", worker: 1 },
          { key: "ui", worker: 2 },
        ]);
        setArchitect(fixture, { activeRunId: null });
        decide(fixture, ["api"]);
        yield* service.tick;
        yield* service.tick;
        assert.deepEqual(keysDelegated(fixture), []);
        assert.lengthOf(fixture.sent, 1);
        assert.include(fixture.sent[0]!, "api can start now");
        setArchitect(fixture, {
          activeRunId: RunId.make("run:architect-2"),
          latestRunId: RunId.make("run:architect-2"),
        });
        yield* service.tick;
        yield* service.tick;
        assert.deepEqual(keysDelegated(fixture), ["api"]);
        assert.deepEqual(fixture.cards[0]?.launches, [
          {
            key: "api",
            taskId: NodeId.make("node:api"),
            childThreadId: ThreadId.make("thread:api"),
          },
        ]);
        assert.equal((yield* service.view(architectId))?.usage.rounds, 1);
      }),
    );
  }),
);

it.effect("waits without a stall while the card waits on the user", () =>
  Effect.gen(function* () {
    const fixture = makeFixture(team({ autonomous: false }));
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* assign(service, [work("api")]);
        setArchitect(fixture, { activeRunId: null });
        yield* service.tick;
        setArchitect(fixture, { latestRunId: RunId.make("run:architect-2") });
        yield* service.tick;
        assert.deepEqual(fixture.sent, []);
        assert.deepEqual(fixture.delegated, []);
        assert.equal((yield* service.view(architectId))?.status, "running");
      }),
    );
  }),
);

it.effect("closes the waiting card and starts nothing when the user stops the team", () =>
  Effect.gen(function* () {
    const fixture = makeFixture(team({ autonomous: false }));
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* assign(service, [work("api")]);
        yield* service.stop({ threadId: architectId });
        assert.equal(fixture.cards[0]?.planStatus, "cancelled");
        assert.equal(fixture.cards[0]?.closedReason, "The user stopped the team.");
        yield* service.tick;
        assert.deepEqual(fixture.delegated, []);
        assert.equal((yield* service.view(architectId))?.status, "stopped");
      }),
    );
  }),
);

it.effect("replaces a card still waiting with the next round", () =>
  Effect.gen(function* () {
    const fixture = makeFixture(team({ autonomous: false }));
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* assign(service, [work("api")]);
        const second = yield* assign(service, [work("api"), work("docs", { worker: 2 })]);
        assert.equal(second.turnItemId, "card:2");
        assert.equal(fixture.cards[0]?.planStatus, "cancelled");
        assert.equal(fixture.cards[0]?.closedReason, "Replaced by a newer proposal.");
        assert.equal(fixture.cards[1]?.planStatus, "pending");
      }),
    );
  }),
);

it.effect("tells the architect once when the user declines the whole round", () =>
  Effect.gen(function* () {
    const fixture = makeFixture(team({ autonomous: false }));
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* assign(service, [work("api")]);
        setArchitect(fixture, { activeRunId: null });
        decide(fixture, []);
        yield* service.tick;
        yield* service.tick;
        assert.lengthOf(fixture.sent, 1);
        assert.include(fixture.sent[0]!, "the user declined api");
        assert.deepEqual(fixture.cards[0]?.launches, []);
        const view = yield* service.view(architectId);
        assert.equal(view?.usage.rounds, 0);
        assert.deepEqual(view?.assignments, []);
      }),
    );
  }),
);

it.effect("refuses an approved round that no longer fits the team's limits", () =>
  Effect.gen(function* () {
    const fixture = makeFixture(
      team({ autonomous: false, limits: { ...DEFAULT_TEAM_LIMITS, maxRounds: 1 } }),
    );
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* assign(service, [work("api")]);
        yield* assign(service, [work("docs")]);
        decide(fixture, ["api"], 0);
        decide(fixture, ["docs"], 1);
        setArchitect(fixture, { activeRunId: null });
        yield* service.tick;
        assert.deepEqual(
          (yield* service.view(architectId))?.assignments.map((row) => row.key),
          ["api"],
        );
        assert.equal(fixture.cards[1]?.launches?.[0]?.key, "docs");
        assert.isDefined(fixture.cards[1]?.launches?.[0]?.failure);
        assert.isTrue(fixture.sent.some((text) => text.includes("could not join the team")));
      }),
    );
  }),
);

it.effect("holds what the user approves while the team is paused until it resumes", () =>
  Effect.gen(function* () {
    const fixture = makeFixture(team({ autonomous: false }));
    yield* withTeam(fixture, (service) =>
      Effect.gen(function* () {
        yield* assign(service, [work("api")]);
        yield* service.pause({ threadId: architectId });
        decide(fixture, ["api"]);
        yield* service.tick;
        assert.deepEqual(fixture.delegated, []);
        assert.deepEqual(
          (yield* service.view(architectId))?.assignments.map((row) => row.key),
          ["api"],
        );
        yield* service.resume({ threadId: architectId });
        yield* service.tick;
        assert.deepEqual(keysDelegated(fixture), ["api"]);
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
