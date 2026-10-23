// @effect-diagnostics nodeBuiltinImport:off - the fixture writes Claude Code transcripts on disk.
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { findForkParents } from "./ClaudeDesktopStore.ts";

const line = (type: string, uuid: string) =>
  JSON.stringify({ type, uuid, message: { content: "x" } });

function writeTranscript(
  root: string,
  folder: string,
  id: string,
  uuids: ReadonlyArray<string>,
  padding = "",
) {
  const dir = NodePath.join(root, folder);
  NodeFs.mkdirSync(dir, { recursive: true });
  const body = uuids.map((uuid, index) => line(index % 2 === 0 ? "user" : "assistant", uuid));
  NodeFs.writeFileSync(NodePath.join(dir, `${id}.jsonl`), `${padding}${body.join("\n")}\n`);
}

const range = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}-${i}`);

const find = (root: string, children: ReadonlyArray<string>, parents: ReadonlyArray<string>) =>
  findForkParents(root, children, new Set(parents)).pipe(Effect.provide(NodeServices.layer));

describe("findForkParents", () => {
  it.effect("finds the parent a session was forked from", () =>
    Effect.gen(function* () {
      const root = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "fork-parents-"));
      writeTranscript(root, "-work-a", "parent", range("p", 40));
      writeTranscript(root, "-work-a", "child", [...range("p", 40), "c-0"]);
      const parents = yield* find(root, ["child"], ["parent"]);
      expect(parents.get("child")).toBe("parent");
    }),
  );

  it.effect("does not call two sessions in one folder a fork when they share little", () =>
    Effect.gen(function* () {
      const root = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "fork-parents-"));
      writeTranscript(root, "-work-a", "first", range("a", 40));
      writeTranscript(root, "-work-a", "second", [...range("a", 2), ...range("b", 38)]);
      const parents = yield* find(root, ["second"], ["first"]);
      expect(parents.get("second")).toBeNull();
    }),
  );

  it.effect("compares only transcripts in the child's project folder", () =>
    Effect.gen(function* () {
      const root = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "fork-parents-"));
      writeTranscript(root, "-work-a", "parent", range("p", 40));
      writeTranscript(root, "-work-b", "child", range("p", 40));
      const parents = yield* find(root, ["child"], ["parent"]);
      expect(parents.get("child")).toBeNull();
    }),
  );

  it.effect("reads transcripts larger than 8 MB", () =>
    Effect.gen(function* () {
      const root = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "fork-parents-"));
      const padding = `${JSON.stringify({ type: "summary", text: "y".repeat(9 * 1024 * 1024) })}\n`;
      writeTranscript(root, "-work-a", "parent", range("p", 40), padding);
      writeTranscript(root, "-work-a", "child", range("p", 40), padding);
      const parents = yield* find(root, ["child"], ["parent"]);
      expect(parents.get("child")).toBe("parent");
    }),
  );
});
