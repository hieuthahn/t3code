import type {
  OrchestrationNestedRepository,
  OrchestrationProjectLibraryEntry,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  ALL_REPOSITORIES_FILTER,
  OUTER_REPOSITORY_FILTER,
  applyRepositoryFilter,
  groupLibraryEntries,
  nestedRepositoryOfFilter,
  repositoryFilterValue,
} from "./libraryGroups";

function entry(path: string, repository: string | null): OrchestrationProjectLibraryEntry {
  return {
    path,
    repository,
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
