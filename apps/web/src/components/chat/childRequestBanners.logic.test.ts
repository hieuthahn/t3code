import { describe, expect, it } from "vite-plus/test";

import { planChildRequestBanners } from "./childRequestBanners.logic";

const approval = { id: "api", hasPendingApprovals: true };
const question = { id: "ui", hasPendingApprovals: false };

describe("planChildRequestBanners", () => {
  it("answers approvals in place and gathers questions into one banner", () => {
    expect(
      planChildRequestBanners({
        childThreadInputs: [approval, question],
        parentAwaitingUser: false,
      }),
    ).toEqual({ approvals: [approval], questions: [question] });
  });

  it("keeps a subagent's approval in view while the parent waits on the user", () => {
    expect(
      planChildRequestBanners({
        childThreadInputs: [approval, question],
        parentAwaitingUser: true,
      }),
    ).toEqual({ approvals: [approval], questions: [] });
  });
});
