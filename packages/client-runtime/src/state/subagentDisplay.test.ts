import { describe, expect, it } from "vite-plus/test";

import { startedThreadsLabel, summarizeSubagentStatuses } from "./subagentDisplay.ts";

describe("startedThreadsLabel", () => {
  it("names app-owned children as started threads", () => {
    expect(startedThreadsLabel([{ origin: "app_owned" }, { origin: "app_owned" }])).toBe(
      "Started 2 threads",
    );
    expect(startedThreadsLabel([{ origin: "app_owned" }])).toBe("Started 1 thread");
  });

  it("keeps the subagent wording when a provider ran any of them", () => {
    expect(startedThreadsLabel([{ origin: "app_owned" }, { origin: "provider_native" }])).toBe(
      "2 subagents",
    );
    expect(startedThreadsLabel([{ origin: "provider_native" }])).toBe("1 subagent");
  });
});

describe("summarizeSubagentStatuses", () => {
  it("maps every child status onto working, done, failed, stopped or idle", () => {
    expect(
      summarizeSubagentStatuses([
        "pending",
        "running",
        "waiting",
        "completed",
        "failed",
        "cancelled",
        "interrupted",
        "idle",
      ]),
    ).toBe("3 working · 1 done · 1 failed · 2 stopped · 1 idle");
  });
});
