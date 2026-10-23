import { describe, expect, it } from "vite-plus/test";

import {
  buildSlackReviewMessage,
  normalizeSlackAssignees,
  projectNameFromRepository,
  resolveStoredSlackAssignees,
} from "./slackReviewMessage";

describe("projectNameFromRepository", () => {
  it.each([
    ["hora-skills-ort-furo", "Hora Skills Ort Furo"],
    ["openreachtech/hora-skills-ort-furo", "Hora Skills Ort Furo"],
    ["t3code", "T3code"],
    ["furo--client-", "Furo Client"],
  ])("names %s as %s", (repository, project) => {
    expect(projectNameFromRepository(repository)).toBe(project);
  });
});

describe("normalizeSlackAssignees", () => {
  it.each([
    ["@ort-internal", "@ort-internal"],
    ["  @ort-internal   @hieu ", "@ort-internal @hieu"],
    ["ort-internal hieu", "@ort-internal @hieu"],
    ["", ""],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeSlackAssignees(input)).toBe(expected);
  });
});

describe("resolveStoredSlackAssignees", () => {
  it.each([
    ["@ort-internal", "@web-team"],
    [" ort-internal ", "@web-team"],
    ["@web-team", "@web-team"],
    ["@ort-internal @hieu", "@ort-internal @hieu"],
    ["@hieu", "@hieu"],
  ])("reads a stored %j as %j", (stored, expected) => {
    expect(resolveStoredSlackAssignees(stored)).toBe(expected);
  });
});

describe("buildSlackReviewMessage", () => {
  it("writes the four review lines and keeps shortcodes and backticks", () => {
    expect(
      buildSlackReviewMessage({
        project: "Hora Skills Ort Furo",
        title: ":rocket: Publish 0.8.0 `--dry-run`",
        assignees: "@ort-internal",
        url: "https://github.com/openreachtech/hora-skills-ort-furo/issues/42",
      }),
    ).toBe(
      [
        "[Project] Hora Skills Ort Furo",
        "[Task] review: :rocket: Publish 0.8.0 `--dry-run`",
        "[Assignee] @ort-internal",
        "[Reference] https://github.com/openreachtech/hora-skills-ort-furo/issues/42",
      ].join("\n"),
    );
  });

  it("trims the title and project and normalizes the assignees", () => {
    expect(
      buildSlackReviewMessage({
        project: "  Furo  ",
        title: " Release 0.8.0 > Main ",
        assignees: "ort-internal  @hieu",
        url: "https://github.com/openreachtech/furo/pull/7",
      }).split("\n"),
    ).toEqual([
      "[Project] Furo",
      "[Task] review: Release 0.8.0 > Main",
      "[Assignee] @ort-internal @hieu",
      "[Reference] https://github.com/openreachtech/furo/pull/7",
    ]);
  });
});
