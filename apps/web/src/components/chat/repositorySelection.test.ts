import { describe, expect, it } from "vite-plus/test";

import {
  buildRepositoryOptions,
  isStaleRepositorySelection,
  joinWorkspacePath,
  repositoryLabelForHeader,
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

describe("resolveSelectedRepositoryPath by touch count", () => {
  it("picks the most touched repository", () => {
    expect(
      resolveSelectedRepositoryPath({
        repositories,
        stored: undefined,
        tagged: ["backend", "nojima-manabu-copy/web"],
        touchCounts: { backend: 2, "nojima-manabu-copy/web": 5 },
      }),
    ).toBe("nojima-manabu-copy/web");
  });

  it("keeps the first tagged repository on a tie", () => {
    expect(
      resolveSelectedRepositoryPath({
        repositories,
        stored: undefined,
        tagged: ["backend", "nojima-manabu-copy/web"],
        touchCounts: { backend: 3, "nojima-manabu-copy/web": 3 },
      }),
    ).toBe("backend");
  });

  it("ignores counts of repositories that are no longer listed", () => {
    expect(
      resolveSelectedRepositoryPath({
        repositories,
        stored: undefined,
        tagged: ["gone", "backend"],
        touchCounts: { gone: 9, backend: 1 },
      }),
    ).toBe("backend");
  });
});

describe("isStaleRepositorySelection", () => {
  it("flags only a nested choice that is no longer listed", () => {
    expect(isStaleRepositorySelection({ repositories, stored: "gone" })).toBe(true);
    expect(isStaleRepositorySelection({ repositories, stored: "backend" })).toBe(false);
    expect(isStaleRepositorySelection({ repositories, stored: null })).toBe(false);
    expect(isStaleRepositorySelection({ repositories, stored: undefined })).toBe(false);
  });
});

describe("repositoryLabelForHeader", () => {
  const options = buildRepositoryOptions({
    workspaceRoot: "/work/nojima",
    projectName: "Nojima",
    projectFolder: "nojima",
    outerBranch: "main",
    repositories,
  });

  it("names the selected repository when the project has nested repositories", () => {
    expect(repositoryLabelForHeader(options, options[1] ?? null)).toBe("backend");
  });

  it("stays hidden without nested repositories or a selection", () => {
    expect(repositoryLabelForHeader(options.slice(0, 1), options[0] ?? null)).toBe(null);
    expect(repositoryLabelForHeader(options, null)).toBe(null);
  });
});
