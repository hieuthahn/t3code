import { describe, expect, it } from "vite-plus/test";

import { hasExplicitProjectIcon } from "./projectIdentity";

describe("hasExplicitProjectIcon", () => {
  it("is false for a project that only has initials from its name", () => {
    expect(hasExplicitProjectIcon(null, null)).toBe(false);
    expect(hasExplicitProjectIcon(undefined, undefined)).toBe(false);
  });

  it("is false when the favicon lookup found nothing in the folder", () => {
    expect(hasExplicitProjectIcon(null, "http://127.0.0.1:3773/api/project-favicon-missing")).toBe(
      false,
    );
  });

  it("is true once someone chose an icon", () => {
    expect(hasExplicitProjectIcon({ kind: "emoji", emoji: "🧪" }, null)).toBe(true);
  });

  it("is true for a favicon found in the project folder", () => {
    expect(hasExplicitProjectIcon(null, "http://127.0.0.1:3773/api/project-favicon?cwd=/a")).toBe(
      true,
    );
  });
});
