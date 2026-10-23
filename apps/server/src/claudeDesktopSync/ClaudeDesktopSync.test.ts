// @effect-diagnostics nodeBuiltinImport:off - the fixture writes Claude Desktop profile files on disk.
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { OrchestrationV2ServerCommand } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfigModule from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as AgentSessionImporter from "../project/AgentSessionImporter.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ClaudeDesktopSync from "./ClaudeDesktopSync.ts";

const NOW = Date.UTC(2026, 9, 23, 12);
const HOUR = 3_600_000;

interface Fixture {
  readonly root: string;
  readonly dispatched: Array<OrchestrationV2ServerCommand>;
}

function makeFixture(desktopTitle: string, t3Title: string): Fixture {
  const root = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "claude-desktop-sync-"));
  const org = NodePath.join(root, "support", "Claude", "claude-code-sessions", "acct", "org");
  NodeFs.mkdirSync(org, { recursive: true });
  NodeFs.writeFileSync(
    NodePath.join(org, "local_a.json"),
    JSON.stringify({
      sessionId: "local_a",
      cliSessionId: "s1",
      cwd: "/work/proj",
      title: desktopTitle,
      isArchived: false,
      createdAt: NOW - 2 * HOUR,
      lastActivityAt: NOW - HOUR,
    }),
  );
  const projects = NodePath.join(root, "projects", "-work-proj");
  NodeFs.mkdirSync(projects, { recursive: true });
  NodeFs.writeFileSync(NodePath.join(projects, "s1.jsonl"), "");
  NodeFs.writeFileSync(NodePath.join(root, "title"), t3Title);
  return { root, dispatched: [] };
}

function layerFor(fixture: Fixture) {
  const shell = {
    id: "t1",
    projectId: "p1",
    title: NodeFs.readFileSync(NodePath.join(fixture.root, "title"), "utf8"),
    archivedAt: null,
    deletedAt: null,
    activeRunId: null,
    createdAt: DateTime.makeUnsafe(NOW - 2 * HOUR),
    updatedAt: DateTime.makeUnsafe(NOW - HOUR),
  };
  const orchestrator = Layer.mock(Orchestrator.OrchestratorV2)({
    getShellSnapshot: (options) =>
      Effect.succeed({
        threads: options?.location === "archive" ? [] : [shell],
        archivedThreads: [],
      } as never),
    getThreadRecords: () =>
      Effect.succeed({
        providerThreads: [{ driver: "claudeAgent", nativeThreadRef: { nativeId: "s1" } }],
      } as never),
    dispatch: (command) =>
      Effect.sync(() => void fixture.dispatched.push(command)).pipe(Effect.as({} as never)),
  });
  const projects = Layer.mock(ProjectService.ProjectService)({
    snapshot: Effect.succeed({ projects: [{ id: "p1", workspaceRoot: "/work/proj" }] } as never),
  });
  const importer = Layer.mock(AgentSessionImporter.AgentSessionImporter)({});
  return ClaudeDesktopSync.layer({
    roots: {
      applicationSupport: NodePath.join(fixture.root, "support"),
      projects: NodePath.join(fixture.root, "projects"),
    },
    now: () => NOW,
  }).pipe(
    Layer.provide(Layer.mergeAll(orchestrator, projects, importer)),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(
      ServerConfigModule.layerTest(process.cwd(), { prefix: "t3-desktop-sync-test-" }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
}

type Request = Parameters<ClaudeDesktopSync.ClaudeDesktopSyncShape["run"]>[0];

const withSync = <A, E>(
  fixture: Fixture,
  body: (
    run: (request: Request) => ReturnType<ClaudeDesktopSync.ClaudeDesktopSyncShape["run"]>,
    baseDir: string,
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const sync = yield* ClaudeDesktopSync.ClaudeDesktopSync;
    const config = yield* ServerConfigModule.ServerConfig;
    return yield* body(sync.run, config.baseDir);
  }).pipe(Effect.provide(layerFor(fixture)));

describe("ClaudeDesktopSync", () => {
  it.effect("offers a title conflict when there is no earlier sync, and starts it unselected", () =>
    withSync(makeFixture("Desktop", "T3"), (run) =>
      Effect.gen(function* () {
        const response = yield* run({ action: "preview" });
        expect(response.preview?.items).toEqual([
          expect.objectContaining({
            kind: "conflict",
            conflictField: "title",
            selectedByDefault: false,
          }),
        ]);
      }),
    ),
  );

  it.effect("renames the T3 thread, records the link, and undoes the rename", () =>
    Effect.suspend(() => {
      const fixture = makeFixture("Desktop", "T3");
      return withSync(fixture, (run) =>
        Effect.gen(function* () {
          const preview = yield* run({ action: "preview" });
          const id = preview.preview?.items[0]?.id ?? "";
          const applied = yield* run({
            action: "apply",
            apply: { selectedIds: [id], conflictChoices: [{ id, side: "desktop" }] },
          });
          expect(applied.apply).toMatchObject({ applied: 1, queuedForDesktop: 0, failed: [] });
          expect(fixture.dispatched).toEqual([
            expect.objectContaining({ type: "thread.metadata.update", title: "Desktop" }),
          ]);

          const second = yield* run({
            action: "apply",
            apply: { selectedIds: [], conflictChoices: [] },
          });
          expect(second.apply).toMatchObject({ applied: 0 });
          const again = yield* run({ action: "preview" });
          expect(again.preview?.canUndo).toBe(true);

          const undone = yield* run({ action: "undoLast" });
          expect(undone.undoLast).toMatchObject({ undone: 1, failed: [] });
          expect(fixture.dispatched[1]).toMatchObject({
            type: "thread.metadata.update",
            title: "T3",
          });
        }),
      );
    }),
  );

  it.effect("queues a Desktop rename for claude-accounts instead of writing the profile", () =>
    Effect.suspend(() => {
      const fixture = makeFixture("Desktop", "T3");
      return withSync(fixture, (run, baseDir) =>
        Effect.gen(function* () {
          const preview = yield* run({ action: "preview" });
          const id = preview.preview?.items[0]?.id ?? "";
          const applied = yield* run({
            action: "apply",
            apply: { selectedIds: [id], conflictChoices: [{ id, side: "t3" }] },
          });
          expect(applied.apply).toMatchObject({ queuedForDesktop: 1 });
          expect(fixture.dispatched).toEqual([]);
          const session = JSON.parse(
            NodeFs.readFileSync(
              NodePath.join(
                fixture.root,
                "support",
                "Claude",
                "claude-code-sessions",
                "acct",
                "org",
                "local_a.json",
              ),
              "utf8",
            ),
          ) as { title: string };
          expect(session.title).toBe("Desktop");
          const pending = JSON.parse(
            NodeFs.readFileSync(NodePath.join(baseDir, "sync", "pending-desktop.json"), "utf8"),
          ) as { ops: Array<{ kind: string; sessionId: string; title: string }> };
          expect(pending.ops).toEqual([
            expect.objectContaining({ kind: "title", sessionId: "local_a", title: "T3" }),
          ]);
        }),
      );
    }),
  );
});
