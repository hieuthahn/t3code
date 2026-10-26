import { assert, it } from "@effect/vitest";

import { relativeToWorkspace, repositoriesInCommand, repositoryOfPath } from "./RepositoryPaths.ts";

it("assigns a path to the longest repository prefix on a segment boundary", () => {
  const repositories = ["backend", "backend/vendor/lib", "apps/admin"];
  assert.equal(repositoryOfPath("backend/vendor/lib/a.ts", repositories), "backend/vendor/lib");
  assert.equal(repositoryOfPath("backend/vendor/other.ts", repositories), "backend");
  assert.equal(repositoryOfPath("backend", repositories), "backend");
  assert.equal(repositoryOfPath("backend-notes.md", repositories), null);
});

it("resolves workspace-relative paths and rejects anything outside the roots", () => {
  const roots = ["/work/project"];
  assert.equal(relativeToWorkspace("/work/project/backend/./a.ts", roots), "backend/a.ts");
  assert.equal(relativeToWorkspace("../backend", roots), null);
  assert.equal(relativeToWorkspace("/work/projectile/backend", roots), null);
  assert.equal(relativeToWorkspace("~/backend", roots), null);
});

it("finds repositories in absolute paths and cd targets, but not in look-alike names", () => {
  const roots = ["/work/project"];
  const repositories = ["backend", "apps/admin"];
  assert.deepEqual(
    repositoriesInCommand("cd /work/project/backend && npm test", roots, repositories),
    ["backend"],
  );
  assert.deepEqual(
    repositoriesInCommand("echo /work/project/backendx/file; cd apps/admin", roots, repositories),
    ["apps/admin"],
  );
});
