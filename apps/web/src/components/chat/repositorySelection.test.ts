import { describe, expect, it } from "vite-plus/test";

import {
  buildRepositoryOptions,
  joinWorkspacePath,
  resolveSelectedRepositoryPath,
} from "./repositorySelection";

const repositories = [
  { path: "backend", name: "backend", branch: "main", originUrl: null },
  { path: "nojima-manabu-copy/web", name: "web", branch: null, originUrl: null },
];

describe("resolveSelectedRepositoryPath", () => {
  it("falls back to the outer repository without tags or a stored choice", () => {
    expect(
      resolveSelectedRepositoryPath({ repositories, stored: undefined, tagged: undefined }),
    ).toBe(null);
  });

  it("defaults to the first tagged repository", () => {
    expect(
      resolveSelectedRepositoryPath({ repositories, stored: undefined, tagged: ["backend"] }),
    ).toBe("backend");
  });

  it("keeps a stored nested choice over the tags", () => {
    expect(
      resolveSelectedRepositoryPath({
        repositories,
        stored: "nojima-manabu-copy/web",
        tagged: ["backend"],
      }),
    ).toBe("nojima-manabu-copy/web");
  });

  it("keeps an explicit outer choice over the tags", () => {
    expect(resolveSelectedRepositoryPath({ repositories, stored: null, tagged: ["backend"] })).toBe(
      null,
    );
  });

  it("falls back to the outer repository when the stored repository disappeared", () => {
    expect(resolveSelectedRepositoryPath({ repositories, stored: "gone", tagged: ["gone"] })).toBe(
      null,
    );
  });
});

describe("buildRepositoryOptions", () => {
  it("lists the outer repository first with the project name and absolute nested paths", () => {
    const options = buildRepositoryOptions({
      workspaceRoot: "/work/nojima-manabu-copy",
      projectName: "Nojima",
      projectFolder: "nojima-manabu-copy",
      outerBranch: "dev",
      repositories,
    });
    expect(options.map((option) => [option.path, option.label, option.branch, option.cwd])).toEqual(
      [
        [null, "Nojima", "dev", "/work/nojima-manabu-copy"],
        ["backend", "backend", "main", "/work/nojima-manabu-copy/backend"],
        ["nojima-manabu-copy/web", "web", null, "/work/nojima-manabu-copy/nojima-manabu-copy/web"],
      ],
    );
  });

  it("keeps a nested repository without commits selectable with no branch", () => {
    const [, , unborn] = buildRepositoryOptions({
      workspaceRoot: "/w",
      projectName: "P",
      projectFolder: "w",
      outerBranch: null,
      repositories,
    });
    expect(unborn?.branch).toBeNull();
  });
});

describe("joinWorkspacePath", () => {
  it("uses the root's separator and ignores a trailing one", () => {
    expect(joinWorkspacePath("/a/b/", "c/d")).toBe("/a/b/c/d");
    expect(joinWorkspacePath("C:\\a", "c/d")).toBe("C:\\a\\c\\d");
  });
});
