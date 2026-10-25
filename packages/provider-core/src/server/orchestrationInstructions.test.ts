import { describe, expect, it } from "vite-plus/test";

import { T3_CODE_ORCHESTRATION_INSTRUCTIONS } from "./orchestrationInstructions.ts";

describe("T3_CODE_ORCHESTRATION_INSTRUCTIONS", () => {
  it("offers an unrelated mid-chat request as a separate thread through propose_tasks", () => {
    expect(T3_CODE_ORCHESTRATION_INSTRUCTIONS).toMatch(
      /unrelated[^.]*separate thread[^.]*\bpropose_tasks\b/s,
    );
    expect(T3_CODE_ORCHESTRATION_INSTRUCTIONS).toContain("Do it here");
  });
});
