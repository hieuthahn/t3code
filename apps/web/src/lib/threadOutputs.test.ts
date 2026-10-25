import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { deriveThreadOutputs } from "./threadOutputs";

function fileChange(
  ordinal: number,
  fields: {
    readonly fileName: string;
    readonly changes?: ReadonlyArray<{ operation: string; path: string; oldPath?: string }>;
    readonly status?: OrchestrationV2TurnItem["status"];
  },
): OrchestrationV2TurnItem {
  return {
    id: `item-${ordinal}`,
    ordinal,
    status: fields.status ?? "completed",
    type: "file_change",
    fileName: fields.fileName,
    ...(fields.changes ? { changes: fields.changes } : {}),
  } as never;
}

describe("deriveThreadOutputs", () => {
  it("lists changed files newest first and keeps one row per path", () => {
    const outputs = deriveThreadOutputs([
      fileChange(1, { fileName: "/repo/a.ts" }),
      fileChange(2, { fileName: "/repo/b.ts" }),
      fileChange(3, { fileName: "/repo/a.ts" }),
    ]);
    expect(outputs).toEqual([
      { path: "/repo/a.ts", status: "edited" },
      { path: "/repo/b.ts", status: "edited" },
    ]);
  });

  it("reads each path from the change list when the provider reports one", () => {
    const outputs = deriveThreadOutputs([
      fileChange(1, {
        fileName: "2 files",
        changes: [
          { operation: "add", path: "/repo/new.md" },
          { operation: "update", path: "/repo/old.md" },
        ],
      }),
    ]);
    expect(outputs).toEqual([
      { path: "/repo/new.md", status: "created" },
      { path: "/repo/old.md", status: "edited" },
    ]);
  });

  it("keeps a file created in this thread as created after later edits", () => {
    const outputs = deriveThreadOutputs([
      fileChange(1, { fileName: "x", changes: [{ operation: "add", path: "/repo/new.md" }] }),
      fileChange(2, { fileName: "x", changes: [{ operation: "update", path: "/repo/new.md" }] }),
    ]);
    expect(outputs).toEqual([{ path: "/repo/new.md", status: "created" }]);
  });

  it("marks a deleted file and moves a renamed one to its new path", () => {
    const outputs = deriveThreadOutputs([
      fileChange(1, { fileName: "x", changes: [{ operation: "update", path: "/repo/gone.md" }] }),
      fileChange(2, { fileName: "x", changes: [{ operation: "delete", path: "/repo/gone.md" }] }),
      fileChange(3, { fileName: "x", changes: [{ operation: "update", path: "/repo/before.md" }] }),
      fileChange(4, {
        fileName: "x",
        changes: [{ operation: "move", path: "/repo/after.md", oldPath: "/repo/before.md" }],
      }),
    ]);
    expect(outputs).toEqual([
      { path: "/repo/after.md", status: "edited" },
      { path: "/repo/gone.md", status: "deleted" },
    ]);
  });

  it("ignores changes that did not complete and items of other types", () => {
    const outputs = deriveThreadOutputs([
      fileChange(1, { fileName: "/repo/failed.ts", status: "failed" }),
      fileChange(2, { fileName: "/repo/running.ts", status: "running" }),
      { id: "m", ordinal: 3, status: "completed", type: "assistant_message" } as never,
    ]);
    expect(outputs).toEqual([]);
  });
});
