import { assert, it } from "@effect/vitest";
import { GitCommandError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { readChildReportGitFacts, type ChildReportGitExecute } from "./childReportGitFacts.ts";

const fakeGit =
  (outputs: Readonly<Record<string, string | null>>): ChildReportGitExecute =>
  (input) => {
    const stdout = outputs[input.args.join(" ")];
    return Effect.succeed(
      stdout === undefined || stdout === null
        ? { exitCode: 128, stdout: "" }
        : { exitCode: 0, stdout },
    );
  };

const repository = {
  "rev-parse --is-inside-work-tree": "true\n",
  "rev-parse --abbrev-ref HEAD": "update/child-report\n",
  "rev-parse HEAD": "1111111111111111111111111111111111111111\n",
  "merge-base HEAD feat/base": "2222222222222222222222222222222222222222\n",
  "rev-list --left-right --count 2222222222222222222222222222222222222222...HEAD": "1\t3\n",
  "status --porcelain": " M apps/web/src/a.ts\n",
  "diff --no-renames --name-status 2222222222222222222222222222222222222222":
    "M\tapps/web/src/a.ts\nA\tapps/web/src/b.ts\nD\told.png\n",
  "diff --no-renames --numstat 2222222222222222222222222222222222222222":
    "10\t2\tapps/web/src/a.ts\n5\t0\tapps/web/src/b.ts\n-\t-\told.png\n",
};

it.effect("reads branch, distance from the base and changed files from the checkout", () =>
  Effect.gen(function* () {
    const facts = yield* readChildReportGitFacts(fakeGit(repository), {
      cwd: "/repo",
      baseRef: "feat/base",
    });
    assert.deepStrictEqual(facts, {
      branch: "update/child-report",
      headSha: "1111111111111111111111111111111111111111",
      baseRef: "feat/base",
      baseSha: "2222222222222222222222222222222222222222",
      aheadBy: 3,
      behindBy: 1,
      dirty: true,
      filesChanged: [
        { path: "apps/web/src/a.ts", status: "M", additions: 10, deletions: 2 },
        { path: "apps/web/src/b.ts", status: "A", additions: 5, deletions: 0 },
        { path: "old.png", status: "D", additions: null, deletions: null },
      ],
      filesTruncated: false,
    });
  }),
);

it.effect("caps the file list and says it was cut", () =>
  Effect.gen(function* () {
    const facts = yield* readChildReportGitFacts(fakeGit(repository), {
      cwd: "/repo",
      baseRef: "feat/base",
      maxFiles: 2,
    });
    assert.deepStrictEqual(
      facts?.filesChanged.map((file) => file.path),
      ["apps/web/src/a.ts", "apps/web/src/b.ts"],
    );
    assert.strictEqual(facts?.filesTruncated, true);
  }),
);

it.effect("leaves the distance and files empty without a base it can resolve", () =>
  Effect.gen(function* () {
    const facts = yield* readChildReportGitFacts(
      fakeGit({ ...repository, "rev-parse --abbrev-ref HEAD": "HEAD\n", "status --porcelain": "" }),
      { cwd: "/repo", baseRef: "missing" },
    );
    assert.deepStrictEqual(facts, {
      branch: null,
      headSha: "1111111111111111111111111111111111111111",
      baseRef: "missing",
      baseSha: null,
      aheadBy: null,
      behindBy: null,
      dirty: false,
      filesChanged: [],
      filesTruncated: false,
    });
  }),
);

it.effect("returns null outside a git repository", () =>
  Effect.gen(function* () {
    const facts = yield* readChildReportGitFacts(fakeGit({}), { cwd: "/tmp", baseRef: null });
    assert.strictEqual(facts, null);
  }),
);

it.effect("returns null when git itself fails", () =>
  Effect.gen(function* () {
    const spawnFailed = new GitCommandError({
      operation: "childReport.gitFacts",
      command: "git",
      cwd: "/repo",
      detail: "spawn failed",
    });
    const facts = yield* readChildReportGitFacts(() => Effect.fail(spawnFailed), {
      cwd: "/repo",
      baseRef: null,
    });
    assert.strictEqual(facts, null);
  }),
);
