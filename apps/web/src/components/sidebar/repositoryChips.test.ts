import { describe, expect, it } from "vite-plus/test";

import {
  MAX_REPOSITORY_CHIPS,
  repositoryShortName,
  summarizeRepositoryChips,
} from "./repositoryChips";

describe("repositoryShortName", () => {
  it("keeps a plain repository name", () => {
    expect(repositoryShortName("backend")).toBe("backend");
  });

  it("strips the project folder prefix", () => {
    expect(repositoryShortName("nojima-manabu/ios", "nojima-manabu")).toBe("ios");
  });

  it("strips the project folder as a name prefix", () => {
    expect(repositoryShortName("nojima-manabu-copy-backend", "nojima-manabu-copy")).toBe("backend");
    expect(repositoryShortName("nojima-manabu-copy-ios", "nojima-manabu-copy")).toBe("ios");
  });

  it("shortens a nested path to its last segment", () => {
    expect(repositoryShortName("services/api")).toBe("api");
  });

  it("keeps a repository that shares the project folder's name when it is the only segment", () => {
    expect(repositoryShortName("backend", "backend")).toBe("backend");
  });
});

describe("summarizeRepositoryChips", () => {
  it("shows no chips for a thread without repository tags", () => {
    expect(summarizeRepositoryChips(undefined)).toBeNull();
    expect(summarizeRepositoryChips([])).toBeNull();
  });

  it("shows a single repository as one chip", () => {
    expect(summarizeRepositoryChips(["backend"])).toEqual({
      labels: ["backend"],
      overflow: 0,
    });
  });

  it("collapses the rest into a +N count past one chip", () => {
    expect(MAX_REPOSITORY_CHIPS).toBe(1);
    expect(summarizeRepositoryChips(["backend", "ios", "web", "docs"])).toEqual({
      labels: ["backend"],
      overflow: 3,
    });
  });

  it("counts repositories that shorten to the same name once", () => {
    expect(summarizeRepositoryChips(["a/api", "b/api", "ios"])).toEqual({
      labels: ["api"],
      overflow: 1,
    });
  });
});
