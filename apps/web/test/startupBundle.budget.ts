// @effect-diagnostics nodeBuiltinImport:off - measures the production build on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";
import { expect, it } from "vite-plus/test";

interface ManifestChunk {
  readonly file: string;
  readonly imports?: ReadonlyArray<string>;
}

// Measured on 2026-10-23 plus about 10%. Raise a budget only with the growth explained.
const BUDGET = {
  entryGzipBytes: 4_400,
  mainGzipBytes: 400_000,
  startupGzipBytes: 1_570_000,
  startupChunks: 160,
};

const HEAVY_LAZY_CHUNKS = [/heic-to/, /^src\/routes\/_chat\./, /\.glb$/];

const distDir = NodePath.resolve(import.meta.dirname, "../dist");
const manifestPath = NodePath.join(distDir, ".vite/manifest.json");
if (!NodeFS.existsSync(manifestPath)) {
  throw new Error(`No build at ${distDir}. Run \`vp run test:bundle\`, which builds first.`);
}
const manifest: Record<string, ManifestChunk> = JSON.parse(
  NodeFS.readFileSync(manifestPath, "utf8"),
);

const gzipBytes = (chunk: ManifestChunk) =>
  NodeZlib.gzipSync(NodeFS.readFileSync(NodePath.join(distDir, chunk.file))).length;

// The entry is a bootstrap that always imports src/main.tsx before the first paint,
// so startup is the static import graph of both.
const startupKeys = new Set<string>();
const visit = (key: string) => {
  if (startupKeys.has(key)) return;
  startupKeys.add(key);
  for (const imported of manifest[key]?.imports ?? []) visit(imported);
};
visit("index.html");
visit("src/main.tsx");

it("keeps the entry and main chunks within budget", () => {
  expect(gzipBytes(manifest["index.html"]!)).toBeLessThanOrEqual(BUDGET.entryGzipBytes);
  expect(gzipBytes(manifest["src/main.tsx"]!)).toBeLessThanOrEqual(BUDGET.mainGzipBytes);
});

it("keeps the chunks loaded at startup within budget", () => {
  const startupGzipBytes = [...startupKeys].reduce(
    (total, key) => total + gzipBytes(manifest[key]!),
    0,
  );
  expect(startupKeys.size).toBeLessThanOrEqual(BUDGET.startupChunks);
  expect(startupGzipBytes).toBeLessThanOrEqual(BUDGET.startupGzipBytes);
});

it("loads heavy chunks only when a feature asks for them", () => {
  expect(
    [...startupKeys].filter((key) => HEAVY_LAZY_CHUNKS.some((pattern) => pattern.test(key))),
  ).toEqual([]);
});
