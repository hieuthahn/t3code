import { RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import {
  latestForkableRunId,
  openSideQuestions,
  parseSideQuestionCommand,
  sideQuestionMainThreadId,
  sideQuestionTitle,
} from "./sideQuestions.logic";

const main = makeThreadFixture({ id: ThreadId.make("thread-main") });
const sideQuestionOf = (id: string, parentId: ThreadId, createdAt: string) => ({
  ...makeThreadFixture({
    id: ThreadId.make(id),
    lineage: {
      rootThreadId: main.id,
      parentThreadId: parentId,
      relationshipToParent: "fork",
      sideQuestion: true,
    },
  }),
  createdAt,
});

describe("parseSideQuestionCommand", () => {
  it("reads the question after /btw and ignores other text", () => {
    expect(parseSideQuestionCommand("/btw why is this test flaky?")).toBe(
      "why is this test flaky?",
    );
    expect(parseSideQuestionCommand("  /BTW  what\nchanged?  ")).toBe("what\nchanged?");
    expect(parseSideQuestionCommand("/btw")).toBe("");
    expect(parseSideQuestionCommand("/btwx question")).toBeNull();
    expect(parseSideQuestionCommand("by the way /btw question")).toBeNull();
  });
});

describe("sideQuestionTitle", () => {
  it("keeps a short question and cuts a long one to one line", () => {
    expect(sideQuestionTitle("what  changed?\n")).toBe("what changed?");
    const title = sideQuestionTitle("word ".repeat(30));
    expect(title).toHaveLength(60);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("latestForkableRunId", () => {
  it("skips the running turn and picks the newest settled one", () => {
    expect(
      latestForkableRunId([
        { id: RunId.make("run-1"), ordinal: 1, status: "completed" },
        { id: RunId.make("run-2"), ordinal: 2, status: "interrupted" },
        { id: RunId.make("run-3"), ordinal: 3, status: "running" },
        { id: RunId.make("run-4"), ordinal: 4, status: "queued" },
      ]),
    ).toBe("run-2");
    expect(latestForkableRunId([{ id: RunId.make("run-1"), ordinal: 1, status: "running" }])).toBe(
      null,
    );
  });
});

describe("side question tabs", () => {
  it("groups nested side questions under the main thread in creation order", () => {
    const first = sideQuestionOf("thread-side-1", main.id, "2026-01-01T00:02:00.000Z");
    const earlier = sideQuestionOf("thread-side-0", main.id, "2026-01-01T00:01:00.000Z");
    const nested = sideQuestionOf("thread-side-nested", first.id, "2026-01-01T00:03:00.000Z");
    const closed = {
      ...sideQuestionOf("thread-side-closed", main.id, "2026-01-01T00:04:00.000Z"),
      archivedAt: "2026-01-01T00:05:00.000Z",
    };
    const fork = makeThreadFixture({
      id: ThreadId.make("thread-fork"),
      lineage: { rootThreadId: main.id, parentThreadId: main.id, relationshipToParent: "fork" },
    });
    const threads = [main, first, earlier, nested, closed, fork];

    expect(sideQuestionMainThreadId(nested.id, threads)).toBe(main.id);
    expect(sideQuestionMainThreadId(main.id, threads)).toBe(main.id);
    expect(sideQuestionMainThreadId(fork.id, threads)).toBe(fork.id);
    expect(openSideQuestions(main.id, threads).map((thread) => thread.id)).toEqual([
      earlier.id,
      first.id,
      nested.id,
    ]);
  });
});
