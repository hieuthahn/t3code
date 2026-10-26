import type {
  OrchestrationNestedRepository,
  OrchestrationProjectLibraryEntry,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  ALL_REPOSITORIES_FILTER,
  OUTER_REPOSITORY_FILTER,
  OUTSIDE_PROJECT_FILTER,
  applyRepositoryFilter,
  groupLibraryEntries,
  libraryScopeOfFilter,
  nestedRepositoryOfFilter,
  repositoryFilterValue,
} from "./libraryGroups";

function entry(
  path: string,
  repository: string | null,
  outsideProject = false,
): OrchestrationProjectLibraryEntry {
  return {
    path,
    repository,
    outsideProject,
    status: "edited",
    threadId: "thread-1",
    threadTitle: "Thread",
    changedAt: "2026-10-26T09:00:00.000Z",
  } as OrchestrationProjectLibraryEntry;
}

const REPOSITORIES = [
  { path: "ios", name: "ios", branch: "main", originUrl: null },
  { path: "backend", name: "backend", branch: "main", originUrl: null },
] as OrchestrationNestedRepository[];

const ENTRIES = [
  entry("ios/App.swift", "ios"),
  entry("README.md", null),
  entry("backend/server.ts", "backend"),
  entry("docs/guide.md", null),
];

describe("groupLibraryEntries", () => {
  it("puts the outer repository first under the project name, then nested ones by path", () => {
    const groups = groupLibraryEntries(ENTRIES, {
      projectTitle: "Nojima",
      repositories: REPOSITORIES,
    });
    expect(groups.map((group) => [group.repository, group.label])).toEqual([
      [null, "Nojima"],
      ["backend", "backend"],
      ["ios", "ios"],
    ]);
    expect(groups[0]?.entries.map((row) => row.path)).toEqual(["README.md", "docs/guide.md"]);
  });

  it("puts files outside the project folder in their own last group", () => {
    const groups = groupLibraryEntries(
      [entry("~/notes.md", null, true), ...ENTRIES, entry("/etc/hosts", null, true)],
      { projectTitle: "Nojima", repositories: REPOSITORIES },
    );
    expect(groups.map((group) => group.label)).toEqual([
      "Nojima",
      "backend",
      "ios",
      "Outside project",
    ]);
    expect(groups[0]?.entries.map((row) => row.path)).toEqual(["README.md", "docs/guide.md"]);
    expect(groups.at(-1)).toMatchObject({ repository: null, outsideProject: true });
    expect(groups.at(-1)?.entries.map((row) => row.path)).toEqual(["~/notes.md", "/etc/hosts"]);
  });

  it("groups outside files even when the project has no nested repositories", () => {
    const groups = groupLibraryEntries([entry("a.ts", null), entry("~/b.ts", null, true)], {
      projectTitle: "Plain",
      repositories: [],
    });
    expect(groups.map((group) => group.label)).toEqual(["Plain", "Outside project"]);
  });

  it("omits a repository that has no rows", () => {
    const groups = groupLibraryEntries([entry("ios/App.swift", "ios")], {
      projectTitle: "Nojima",
      repositories: REPOSITORIES,
    });
    expect(groups.map((group) => group.repository)).toEqual(["ios"]);
  });

  it("returns no groups for a project without nested repositories", () => {
    expect(
      groupLibraryEntries([entry("README.md", null)], { projectTitle: "Plain", repositories: [] }),
    ).toEqual([]);
  });
});

describe("applyRepositoryFilter", () => {
  it("keeps every row for All", () => {
    expect(applyRepositoryFilter(ENTRIES, ALL_REPOSITORIES_FILTER)).toHaveLength(4);
  });

  it("keeps only outer rows for the outer repository", () => {
    expect(applyRepositoryFilter(ENTRIES, OUTER_REPOSITORY_FILTER).map((row) => row.path)).toEqual([
      "README.md",
      "docs/guide.md",
    ]);
  });

  it("keeps outside files out of the outer repository and alone under their filter", () => {
    const rows = [...ENTRIES, entry("~/notes.md", null, true)];
    expect(applyRepositoryFilter(rows, OUTER_REPOSITORY_FILTER).map((row) => row.path)).toEqual([
      "README.md",
      "docs/guide.md",
    ]);
    expect(applyRepositoryFilter(rows, OUTSIDE_PROJECT_FILTER).map((row) => row.path)).toEqual([
      "~/notes.md",
    ]);
  });

  it("maps the outer and outside filters to server scopes", () => {
    expect(libraryScopeOfFilter(OUTER_REPOSITORY_FILTER)).toBe("outer");
    expect(libraryScopeOfFilter(OUTSIDE_PROJECT_FILTER)).toBe("outside");
    expect(libraryScopeOfFilter(repositoryFilterValue("ios"))).toBeUndefined();
    expect(libraryScopeOfFilter(ALL_REPOSITORIES_FILTER)).toBeUndefined();
  });

  it("keeps only one nested repository's rows", () => {
    const filter = repositoryFilterValue("ios");
    expect(nestedRepositoryOfFilter(filter)).toBe("ios");
    expect(applyRepositoryFilter(ENTRIES, filter).map((row) => row.path)).toEqual([
      "ios/App.swift",
    ]);
  });

  it("does not mistake a repository named outer or all for a fixed filter", () => {
    expect(nestedRepositoryOfFilter(repositoryFilterValue("outer"))).toBe("outer");
    expect(nestedRepositoryOfFilter(OUTER_REPOSITORY_FILTER)).toBeNull();
  });
});
