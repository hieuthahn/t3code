import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  AuthSessionId,
  ProjectId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type Project,
  type ProjectScript,
  type ServerSettings as ServerSettingsValue,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";

import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as MergeQueueService from "./MergeQueueService.ts";

const projectId = ProjectId.make("project:merge-queue");
const ownerThreadId = ThreadId.make("thread:owner");
const decidedBy = { actor: "user", authSessionId: AuthSessionId.make("session:web") } as const;

interface Fixture {
  readonly repository: string;
  readonly shells: Map<ThreadId, OrchestrationV2ThreadShell>;
  readonly scripts: Array<ProjectScript>;
  /** Scripts saved in the environment's project settings, which win over the project's own. */
  readonly settingsScripts: Array<ProjectScript>;
  readonly sent: Array<{ readonly threadId: ThreadId; readonly text: string }>;
}

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    const result = yield* driver.execute({
      operation: "MergeQueueService.test.git",
      cwd,
      args,
      timeoutMs: 20_000,
    });
    return result.stdout.trim();
  });

const shell = (input: {
  readonly id: ThreadId;
  readonly title: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly parentThreadId: ThreadId | null;
  readonly activeRunId?: string;
}) =>
  ({
    id: input.id,
    activeRunId: input.activeRunId ?? null,
    projectId,
    title: input.title,
    branch: input.branch,
    worktreePath: input.worktreePath,
    lineage: {
      rootThreadId: input.parentThreadId ?? input.id,
      parentThreadId: input.parentThreadId,
      relationshipToParent: input.parentThreadId === null ? null : "subagent",
    },
  }) as unknown as OrchestrationV2ThreadShell;

const gate = (name: string, command: string): ProjectScript => ({
  id: name,
  name,
  command,
  icon: "test",
  runOnWorktreeCreate: false,
  runAsMergeGate: true,
});

const makeFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const repository = yield* fs.makeTempDirectoryScoped({ prefix: "t3-merge-queue-" });
  yield* git(repository, ["init", "--initial-branch=main"]);
  yield* git(repository, ["config", "user.email", "test@test.com"]);
  yield* git(repository, ["config", "user.name", "Test"]);
  yield* git(repository, ["config", "commit.gpgsign", "false"]);
  yield* fs.writeFileString(`${repository}/README.md`, "# demo\n");
  yield* git(repository, ["add", "."]);
  yield* git(repository, ["commit", "-m", "Add readme"]);
  const fixture: Fixture = {
    repository,
    shells: new Map([
      [
        ownerThreadId,
        shell({
          id: ownerThreadId,
          title: "Refactor retry",
          branch: "main",
          worktreePath: null,
          parentThreadId: null,
        }),
      ],
    ]),
    scripts: [gate("passes", "true")],
    settingsScripts: [],
    sent: [],
  };
  return fixture;
});

/** Give the owner a child on its own branch and worktree, with one commit adding `file`. */
const addChild = (fixture: Fixture, key: string, file: string, contents = `${key}\n`) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const worktree = path.join(
      fixture.repository,
      "..",
      `${path.basename(fixture.repository)}-${key}`,
    );
    yield* git(fixture.repository, ["worktree", "add", "-b", `child/${key}`, worktree, "main"]);
    yield* fs.writeFileString(path.join(worktree, file), contents);
    yield* git(worktree, ["add", "."]);
    yield* git(worktree, ["commit", "-m", `Add ${key}`]);
    const childThreadId = ThreadId.make(`thread:${key}`);
    fixture.shells.set(
      childThreadId,
      shell({
        id: childThreadId,
        title: `Do ${key}`,
        branch: `child/${key}`,
        worktreePath: worktree,
        parentThreadId: ownerThreadId,
      }),
    );
    return { childThreadId, worktree };
  });

const layerFor = (fixture: Fixture) => {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerGit = GitVcsDriver.layer.pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-merge-queue-config-" })),
    Layer.provideMerge(NodeServices.layer),
  );
  return MergeQueueService.layerWith({ drainOnApprove: false }).pipe(
    Layer.provide(
      Layer.mergeAll(
        layerDatabase,
        layerGit,
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThreadShell: (threadId) => Effect.succeed(fixture.shells.get(threadId) ?? null),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeedSome({
              id: projectId,
              workspaceRoot: fixture.repository,
              scripts: fixture.scripts,
            } as unknown as Project),
        }),
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.sync(
            () =>
              ({
                defaultProjectScripts: [],
                projectScriptOverrides: {},
                projectSettingsFolded: false,
                projectSettingsOverrides:
                  fixture.settingsScripts.length === 0
                    ? {}
                    : { [projectId]: { defaultProjectScripts: fixture.settingsScripts } },
              }) as unknown as ServerSettingsValue,
          ),
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({
          sendToThread: (input) =>
            Effect.sync(() => {
              fixture.sent.push({ threadId: input.threadId, text: input.text });
              return {} as never;
            }),
        }),
      ),
    ),
  );
};

const withQueue = <A, E>(
  body: (input: {
    readonly fixture: Fixture;
    readonly queue: MergeQueueService.MergeQueueService["Service"];
  }) => Effect.Effect<A, E, GitVcsDriver.GitVcsDriver | FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fixture = yield* makeFixture;
    return yield* Effect.gen(function* () {
      const queue = yield* MergeQueueService.MergeQueueService;
      return yield* body({ fixture, queue });
    }).pipe(Effect.provide(layerFor(fixture)));
  }).pipe(
    Effect.scoped,
    Effect.provide(
      GitVcsDriver.layer.pipe(
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-merge-queue-test-" })),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

const approveAndDrain = (
  queue: MergeQueueService.MergeQueueService["Service"],
  item: { readonly id: MergeQueueService.MergeQueueItem["id"]; readonly headShaAtEnqueue: string },
) =>
  queue
    .approve({ itemId: item.id, headSha: item.headShaAtEnqueue }, decidedBy)
    .pipe(Effect.andThen(queue.drain));

it.live("lands two children in order, and the second gate runs on a trunk with the first", () =>
  withQueue(({ fixture, queue }) =>
    Effect.gen(function* () {
      fixture.scripts.push(gate("api file present", "test -f api.txt"));
      const api = yield* addChild(fixture, "api", "api.txt");
      const ui = yield* addChild(fixture, "ui", "ui.txt");
      const first = yield* queue.enqueue({
        callerThreadId: ownerThreadId,
        childThreadId: api.childThreadId,
      });
      const second = yield* queue.enqueue({
        callerThreadId: ownerThreadId,
        childThreadId: ui.childThreadId,
      });
      assert.equal(first.status, "awaiting_user");
      assert.equal(first.trunkRef, "main");

      yield* queue.approve({ itemId: first.id, headSha: first.headShaAtEnqueue }, decidedBy);
      yield* queue.approve({ itemId: second.id, headSha: second.headShaAtEnqueue }, decidedBy);
      yield* queue.drain;

      const view = yield* queue.view(ownerThreadId);
      assert.deepEqual(
        view.items.map((item) => item.status),
        ["merged", "merged"],
      );
      assert.deepEqual(
        view.items[1]?.gateRuns.map((run) => run.exitCode),
        [0, 0],
      );
      assert.deepEqual(view.items[0]?.approvedBy, decidedBy);
      const trunkHead = yield* git(fixture.repository, ["rev-parse", "main"]);
      assert.equal(view.items[1]?.mergedSha, trunkHead);
      assert.isFalse(view.trunks[0]?.movedOutsideQueue ?? true);
      const files = yield* git(fixture.repository, ["ls-tree", "--name-only", "main"]);
      assert.deepEqual(files.split("\n").sort(), ["README.md", "api.txt", "ui.txt"]);
      const subjects = yield* git(fixture.repository, ["log", "--format=%s", "--reverse", "main"]);
      assert.isBelow(subjects.indexOf("Add api"), subjects.indexOf("Add ui"));
      assert.deepEqual(fixture.sent, []);
    }),
  ),
);

it.live("fails a child whose branch conflicts with the trunk and tells it why", () =>
  withQueue(({ fixture, queue }) =>
    Effect.gen(function* () {
      const api = yield* addChild(fixture, "api", "README.md", "# api\n");
      const ui = yield* addChild(fixture, "ui", "README.md", "# ui\n");
      const first = yield* queue.enqueue({
        callerThreadId: ownerThreadId,
        childThreadId: api.childThreadId,
      });
      yield* approveAndDrain(queue, first);
      const second = yield* queue.enqueue({
        callerThreadId: ownerThreadId,
        childThreadId: ui.childThreadId,
      });
      yield* approveAndDrain(queue, second);

      const view = yield* queue.view(ownerThreadId);
      assert.equal(view.items[1]?.status, "failed");
      assert.equal(view.items[1]?.failure?.stage, "update");
      assert.equal(yield* git(ui.worktree, ["status", "--porcelain"]), "");
      assert.equal(fixture.sent[0]?.threadId, ui.childThreadId);
      assert.include(fixture.sent[0]?.text ?? "", "conflict");
    }),
  ),
);

it.live("keeps a child out of the trunk when a gate fails and sends it the output", () =>
  withQueue(({ fixture, queue }) =>
    Effect.gen(function* () {
      fixture.scripts.push(gate("unit tests", "echo broken retry test >&2; exit 3"));
      const api = yield* addChild(fixture, "api", "api.txt");
      const trunkBefore = yield* git(fixture.repository, ["rev-parse", "main"]);
      const item = yield* queue.enqueue({
        callerThreadId: ownerThreadId,
        childThreadId: api.childThreadId,
      });
      yield* approveAndDrain(queue, item);

      const failed = (yield* queue.view(ownerThreadId)).items[0];
      assert.equal(failed?.status, "failed");
      assert.equal(failed?.failure?.stage, "gate");
      assert.equal(failed?.gateRuns.at(-1)?.exitCode, 3);
      assert.include(failed?.gateRuns.at(-1)?.outputTail ?? "", "broken retry test");
      assert.equal(yield* git(fixture.repository, ["rev-parse", "main"]), trunkBefore);
      assert.include(fixture.sent[0]?.text ?? "", "broken retry test");
    }),
  ),
);

it.live("runs the gates saved in the environment's project settings", () =>
  withQueue(({ fixture, queue }) =>
    Effect.gen(function* () {
      fixture.settingsScripts.push(gate("no TODO", "! git grep -n TODO"));
      const notes = yield* addChild(fixture, "notes", "notes.txt", "TODO: write notes\n");
      const trunkBefore = yield* git(fixture.repository, ["rev-parse", "main"]);
      const item = yield* queue.enqueue({
        callerThreadId: ownerThreadId,
        childThreadId: notes.childThreadId,
      });
      yield* approveAndDrain(queue, item);

      const failed = (yield* queue.view(ownerThreadId)).items[0];
      assert.equal(failed?.failure?.stage, "gate");
      assert.include(failed?.gateRuns.at(-1)?.outputTail ?? "", "notes.txt");
      assert.equal(yield* git(fixture.repository, ["rev-parse", "main"]), trunkBefore);
    }),
  ),
);

it.live("lands on the branch the owner's checkout has out when its thread records none", () =>
  withQueue(({ fixture, queue }) =>
    Effect.gen(function* () {
      fixture.shells.set(
        ownerThreadId,
        shell({
          id: ownerThreadId,
          title: "Refactor retry",
          branch: null,
          worktreePath: null,
          parentThreadId: null,
        }),
      );
      const api = yield* addChild(fixture, "api", "api.txt");
      const item = yield* queue.enqueue({
        callerThreadId: ownerThreadId,
        childThreadId: api.childThreadId,
      });
      assert.equal(item.trunkRef, "main");
      yield* approveAndDrain(queue, item);
      assert.equal((yield* queue.view(ownerThreadId)).items[0]?.status, "merged");
    }),
  ),
);

it.live("refuses commits the user did not approve", () =>
  withQueue(({ fixture, queue }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const api = yield* addChild(fixture, "api", "api.txt");
      const item = yield* queue.enqueue({
        callerThreadId: ownerThreadId,
        childThreadId: api.childThreadId,
      });
      const wrongHead = yield* queue
        .approve({ itemId: item.id, headSha: "0000000" }, decidedBy)
        .pipe(Effect.result);
      assert.isTrue(Result.isFailure(wrongHead));

      yield* queue.approve({ itemId: item.id, headSha: item.headShaAtEnqueue }, decidedBy);
      yield* fs.writeFileString(`${api.worktree}/late.txt`, "late\n");
      yield* git(api.worktree, ["add", "."]);
      yield* git(api.worktree, ["commit", "-m", "Add a late change"]);
      yield* queue.drain;

      const moved = (yield* queue.view(ownerThreadId)).items[0];
      assert.equal(moved?.status, "failed");
      assert.equal(moved?.failure?.stage, "head_moved");
      const files = yield* git(fixture.repository, ["ls-tree", "--name-only", "main"]);
      assert.notInclude(files, "late.txt");
    }),
  ),
);

it.live("refuses commits that land on the child while its gates run", () =>
  withQueue(({ fixture, queue }) =>
    Effect.gen(function* () {
      fixture.scripts.push(
        gate(
          "sneaky",
          "echo sneaky > sneaky.txt && git add . && git commit -qm 'Add a sneaky change'",
        ),
      );
      const api = yield* addChild(fixture, "api", "api.txt");
      const item = yield* queue.enqueue({
        callerThreadId: ownerThreadId,
        childThreadId: api.childThreadId,
      });
      yield* approveAndDrain(queue, item);

      const moved = (yield* queue.view(ownerThreadId)).items[0];
      assert.equal(moved?.status, "failed");
      assert.equal(moved?.failure?.stage, "head_moved");
      const files = yield* git(fixture.repository, ["ls-tree", "--name-only", "main"]);
      assert.notInclude(files, "sneaky.txt");
    }),
  ),
);

it.live("warns the owner when the trunk moved outside the queue", () =>
  withQueue(({ fixture, queue }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const api = yield* addChild(fixture, "api", "api.txt");
      const item = yield* queue.enqueue({
        callerThreadId: ownerThreadId,
        childThreadId: api.childThreadId,
      });
      yield* approveAndDrain(queue, item);
      assert.isFalse((yield* queue.view(ownerThreadId)).trunks[0]?.movedOutsideQueue ?? true);

      yield* fs.writeFileString(`${fixture.repository}/hotfix.txt`, "hotfix\n");
      yield* git(fixture.repository, ["add", "."]);
      yield* git(fixture.repository, ["commit", "-m", "Add a hotfix by hand"]);

      assert.isTrue((yield* queue.view(ownerThreadId)).trunks[0]?.movedOutsideQueue ?? false);
    }),
  ),
);

it.live("lets only a child's own parent queue it", () =>
  withQueue(({ fixture, queue }) =>
    Effect.gen(function* () {
      const api = yield* addChild(fixture, "api", "api.txt");
      const stranger = yield* queue
        .enqueue({
          callerThreadId: ThreadId.make("thread:stranger"),
          childThreadId: api.childThreadId,
        })
        .pipe(Effect.result);
      assert.isTrue(Result.isFailure(stranger));
      assert.deepEqual((yield* queue.view(ownerThreadId)).items, []);
    }),
  ),
);

it.live("refuses to queue or approve a child when the project has no merge gate", () =>
  withQueue(({ fixture, queue }) =>
    Effect.gen(function* () {
      const api = yield* addChild(fixture, "api", "api.txt");
      const item = yield* queue.enqueue({
        callerThreadId: ownerThreadId,
        childThreadId: api.childThreadId,
      });
      fixture.scripts.length = 0;
      const approved = yield* queue
        .approve({ itemId: item.id, headSha: item.headShaAtEnqueue }, decidedBy)
        .pipe(Effect.result);
      assert.isTrue(Result.isFailure(approved));
      assert.equal((yield* queue.view(ownerThreadId)).items[0]?.status, "awaiting_user");

      const ui = yield* addChild(fixture, "ui", "ui.txt");
      const queued = yield* queue
        .enqueue({ callerThreadId: ownerThreadId, childThreadId: ui.childThreadId })
        .pipe(Effect.result);
      assert.isTrue(Result.isFailure(queued));
      if (Result.isFailure(queued)) assert.include(queued.failure.message, "merge gate");
    }),
  ),
);

it.live("keeps the trunk when the gates are gone by the time an item lands", () =>
  withQueue(({ fixture, queue }) =>
    Effect.gen(function* () {
      const api = yield* addChild(fixture, "api", "api.txt");
      const trunkBefore = yield* git(fixture.repository, ["rev-parse", "main"]);
      const item = yield* queue.enqueue({
        callerThreadId: ownerThreadId,
        childThreadId: api.childThreadId,
      });
      yield* queue.approve({ itemId: item.id, headSha: item.headShaAtEnqueue }, decidedBy);
      fixture.scripts.length = 0;
      yield* queue.drain;

      const failed = (yield* queue.view(ownerThreadId)).items[0];
      assert.equal(failed?.status, "failed");
      assert.equal(failed?.failure?.stage, "gate");
      assert.equal(yield* git(fixture.repository, ["rev-parse", "main"]), trunkBefore);
    }),
  ),
);

it.live("leaves a running child's worktree alone", () =>
  withQueue(({ fixture, queue }) =>
    Effect.gen(function* () {
      const api = yield* addChild(fixture, "api", "api.txt");
      const ui = yield* addChild(fixture, "ui", "ui.txt");
      yield* approveAndDrain(
        queue,
        yield* queue.enqueue({ callerThreadId: ownerThreadId, childThreadId: api.childThreadId }),
      );
      fixture.shells.set(
        ui.childThreadId,
        shell({
          id: ui.childThreadId,
          title: "Do ui",
          branch: "child/ui",
          worktreePath: ui.worktree,
          parentThreadId: ownerThreadId,
          activeRunId: "run:ui",
        }),
      );
      const childHead = yield* git(ui.worktree, ["rev-parse", "HEAD"]);
      yield* approveAndDrain(
        queue,
        yield* queue.enqueue({ callerThreadId: ownerThreadId, childThreadId: ui.childThreadId }),
      );

      const refused = (yield* queue.view(ownerThreadId)).items[1];
      assert.equal(refused?.status, "failed");
      assert.equal(refused?.failure?.stage, "update");
      assert.include(refused?.failure?.message ?? "", "still running");
      assert.equal(yield* git(ui.worktree, ["rev-parse", "HEAD"]), childHead);
    }),
  ),
);

it.live("moves a trunk nobody has out, but not one checked out in another worktree", () =>
  withQueue(({ fixture, queue }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const api = yield* addChild(fixture, "api", "api.txt");
      const ui = yield* addChild(fixture, "ui", "ui.txt");
      const first = yield* queue.enqueue({
        callerThreadId: ownerThreadId,
        childThreadId: api.childThreadId,
      });
      yield* git(fixture.repository, ["switch", "-c", "other"]);
      yield* approveAndDrain(queue, first);
      assert.equal((yield* queue.view(ownerThreadId)).items[0]?.status, "merged");
      const trunkAfterFirst = yield* git(fixture.repository, ["rev-parse", "main"]);
      assert.equal((yield* queue.view(ownerThreadId)).items[0]?.mergedSha, trunkAfterFirst);

      const elsewhere = path.join(
        fixture.repository,
        "..",
        `${path.basename(fixture.repository)}-main`,
      );
      yield* git(fixture.repository, ["worktree", "add", elsewhere, "main"]);
      yield* approveAndDrain(
        queue,
        yield* queue.enqueue({ callerThreadId: ownerThreadId, childThreadId: ui.childThreadId }),
      );

      const refused = (yield* queue.view(ownerThreadId)).items[1];
      assert.equal(refused?.status, "failed");
      assert.equal(refused?.failure?.stage, "merge");
      assert.include(refused?.failure?.message ?? "", elsewhere);
      assert.equal(yield* git(fixture.repository, ["rev-parse", "main"]), trunkAfterFirst);
    }),
  ),
);
