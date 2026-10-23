import { describe, expect, it } from "@effect/vitest";

import {
  planSync,
  type DesktopSession,
  type PlanInput,
  type SyncLink,
  type T3Thread,
} from "./ClaudeDesktopSyncPlan.ts";

const NOW = 10_000_000;

function desktop(overrides: Partial<DesktopSession> = {}): DesktopSession {
  return {
    localId: "local_a",
    orgId: "org",
    cliSessionId: "s1",
    priorCliSessionIds: [],
    cwd: "/work/proj",
    title: "Desktop title",
    isArchived: false,
    deleted: false,
    scratch: false,
    hasTranscript: true,
    lastActivityAt: NOW - 3_600_000,
    createdAt: NOW - 7_200_000,
    ...overrides,
  };
}

function thread(overrides: Partial<T3Thread> = {}): T3Thread {
  return {
    threadId: "t1",
    projectId: "p1",
    workspaceRoot: "/work/proj",
    title: "Desktop title",
    archived: false,
    deleted: false,
    running: false,
    claudeSessionIds: ["s1"],
    hasTranscript: true,
    createdAt: NOW - 7_200_000,
    updatedAt: NOW - 3_600_000,
    ...overrides,
  };
}

function link(overrides: Partial<SyncLink> = {}): SyncLink {
  return {
    desktopLocalId: "local_a",
    t3ThreadId: "t1",
    sessionIds: ["s1"],
    desktop: { title: "Desktop title", isArchived: false },
    t3: { title: "Desktop title", archived: false },
    syncedAt: NOW - 60_000,
    ...overrides,
  };
}

function plan(input: Partial<PlanInput>) {
  return planSync({
    desktop: [],
    threads: [],
    links: [],
    now: NOW,
    forkParentOf: () => null,
    ...input,
  });
}

const kinds = (input: Partial<PlanInput>) => plan(input).items.map((item) => item.kind);

describe("planSync", () => {
  it("imports an unmatched Desktop session and creates an unmatched Claude thread in Desktop", () => {
    expect(kinds({ desktop: [desktop()] })).toEqual(["importToT3"]);
    expect(kinds({ threads: [thread()] })).toEqual(["createInDesktop"]);
  });

  it("matches a thread through an earlier cliSessionId of the Desktop session", () => {
    const result = plan({
      desktop: [desktop({ cliSessionId: "s2", priorCliSessionIds: ["s1"] })],
      threads: [thread()],
    });
    expect(result.items).toEqual([]);
    expect(result.pairs).toHaveLength(1);
  });

  it("skips a fork of a session T3 already holds instead of importing it again", () => {
    const items = plan({
      desktop: [desktop({ localId: "local_b", cliSessionId: "fork" })],
      threads: [thread({ archived: true })],
      forkParentOf: (id) => (id === "fork" ? "s1" : null),
    }).items;
    expect(items).toEqual([
      expect.objectContaining({ kind: "skip", reason: "fork of a session T3 already has" }),
    ]);
  });

  it("skips ambiguous matches in both directions", () => {
    expect(
      kinds({ desktop: [desktop()], threads: [thread(), thread({ threadId: "t2" })] }),
    ).toEqual(["skip"]);
    expect(
      kinds({
        desktop: [
          desktop(),
          desktop({ localId: "local_b", cliSessionId: "s9", priorCliSessionIds: ["s1"] }),
        ],
        threads: [thread()],
      }),
    ).toEqual(["skip", "skip"]);
  });

  it("takes the title from the side that changed since the last sync", () => {
    const fromDesktop = plan({
      desktop: [desktop({ title: "New" })],
      threads: [thread()],
      links: [link()],
    }).items;
    expect(fromDesktop).toEqual([expect.objectContaining({ kind: "renameT3", title: "New" })]);
    const fromT3 = plan({
      desktop: [desktop()],
      threads: [thread({ title: "New" })],
      links: [link()],
    }).items;
    expect(fromT3).toEqual([expect.objectContaining({ kind: "renameDesktop", title: "New" })]);
  });

  it("reports a conflict when both sides changed, or when there is no earlier sync", () => {
    expect(
      kinds({
        desktop: [desktop({ title: "A" })],
        threads: [thread({ title: "B" })],
        links: [link()],
      }),
    ).toEqual(["conflict"]);
    expect(
      kinds({ desktop: [desktop({ title: "A" })], threads: [thread({ title: "B" })] }),
    ).toEqual(["conflict"]);
  });

  it("follows archive changes the same way", () => {
    const items = plan({
      desktop: [desktop({ isArchived: true })],
      threads: [thread()],
      links: [link()],
    }).items;
    expect(items).toEqual([expect.objectContaining({ kind: "archiveT3", archived: true })]);
    expect(
      kinds({ desktop: [desktop()], threads: [thread({ archived: true })], links: [link()] }),
    ).toEqual(["archiveDesktop"]);
  });

  it("turns a deletion on one side into an archive suggestion, never a deletion", () => {
    expect(
      kinds({ desktop: [desktop({ deleted: true })], threads: [thread()], links: [link()] }),
    ).toEqual(["suggestArchiveT3"]);
    expect(
      kinds({ desktop: [desktop()], threads: [thread({ deleted: true })], links: [link()] }),
    ).toEqual(["suggestArchiveDesktop"]);
  });

  it("leaves sessions that are running or just active alone", () => {
    expect(
      kinds({
        desktop: [desktop({ title: "New" })],
        threads: [thread({ running: true })],
        links: [link()],
      }),
    ).toEqual(["skip"]);
    expect(kinds({ desktop: [desktop({ lastActivityAt: NOW - 1000 })] })).toEqual(["skip"]);
  });

  it("does not offer threads it cannot represent in Desktop", () => {
    const items = plan({
      threads: [
        thread({ threadId: "codex", claudeSessionIds: [] }),
        thread({ threadId: "scratch", workspaceRoot: "/x/scratch-workspaces/a" }),
        thread({ threadId: "gone", hasTranscript: false }),
      ],
    }).items;
    expect(items.map((item) => (item.kind === "skip" ? item.reason : item.kind))).toEqual([
      "not a Claude thread",
      "scratch workspace",
      "no transcript on disk",
    ]);
  });

  it("does not import archived or deleted Desktop sessions", () => {
    expect(
      kinds({
        desktop: [desktop({ isArchived: true }), desktop({ localId: "local_b", deleted: true })],
      }),
    ).toEqual([]);
  });
});
