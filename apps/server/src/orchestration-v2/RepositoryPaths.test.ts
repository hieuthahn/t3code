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

const roots = ["/work/project"];
const repositories = ["backend", "apps/admin", "wt"];

it("ignores paths inside quoted commit messages and echo arguments", () => {
  assert.deepEqual(
    repositoriesInCommand(
      'git commit -m "fix /work/project/backend/a.ts; cd wt"',
      roots,
      repositories,
    ),
    [],
  );
  assert.deepEqual(
    repositoriesInCommand(
      "git commit -am 'cd backend' && echo \"/work/project/wt/x\" && cd apps/admin",
      roots,
      repositories,
    ),
    ["apps/admin"],
  );
});

it("resolves a relative cd against the directory an earlier cd reached", () => {
  assert.deepEqual(repositoriesInCommand("cd apps && cd admin && ls", roots, repositories), [
    "apps/admin",
  ]);
  assert.deepEqual(repositoriesInCommand("cd backend && cd ../wt", roots, repositories), [
    "backend",
    "wt",
  ]);
  assert.deepEqual(repositoriesInCommand("cd /etc && cd wt", roots, repositories), []);
  assert.deepEqual(repositoriesInCommand("cd wt", roots, repositories), ["wt"]);
});

it("ends an absolute path at : , = and >", () => {
  for (const suffix of [":12", ",x", "=1", ">out.log"]) {
    assert.deepEqual(
      repositoriesInCommand(`grep foo /work/project/backend${suffix}`, roots, repositories),
      ["backend"],
    );
  }
  assert.deepEqual(
    repositoriesInCommand("ls /work/project/backend-notes", roots, repositories),
    [],
  );
});

it("strips the /private prefix only on darwin", () => {
  const darwin = { platform: "darwin" } as const;
  const linux = { platform: "linux" } as const;
  assert.equal(
    relativeToWorkspace("/private/work/project/backend/a.ts", roots, darwin),
    "backend/a.ts",
  );
  assert.deepEqual(
    repositoriesInCommand("cat /private/work/project/backend/a.ts", roots, repositories, darwin),
    ["backend"],
  );
  assert.equal(relativeToWorkspace("/private/work/project/backend/a.ts", roots, linux), null);
  assert.deepEqual(
    repositoriesInCommand("cat /private/work/project/backend/a.ts", roots, repositories, linux),
    [],
  );
});
