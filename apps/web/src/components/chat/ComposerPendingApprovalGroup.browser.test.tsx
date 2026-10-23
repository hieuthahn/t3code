import { RuntimeRequestId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import type { PendingApproval } from "../../session-logic";
import { ComposerPendingApprovalGroup } from "./ComposerPendingApprovalGroup";

const approval = (id: string, detail: string, extra: Partial<PendingApproval> = {}) =>
  ({
    requestId: RuntimeRequestId.make(id),
    requestKind: "command",
    createdAt: "2026-10-23T00:00:00Z",
    detail,
    responseCapability: "live",
    ...extra,
  }) satisfies PendingApproval;

const approvals = [
  approval("first", "pnpm test"),
  approval("second", "git status"),
  approval("gone", "rm -rf build", { responseCapability: "not_resumable" }),
];

it("approves every live request one at a time through the per-request answer", async () => {
  const answered: Array<[RuntimeRequestId, string]> = [];
  const onRespondToApproval = vi.fn(async (requestId: RuntimeRequestId, decision: string) => {
    answered.push([requestId, decision]);
  });
  await using _screen = await render(
    <ComposerPendingApprovalGroup
      approvals={approvals}
      respondingRequestIds={[]}
      disabled={false}
      onRespondToApproval={onRespondToApproval}
    />,
  );

  await expect.element(page.getByText("3 approvals")).toBeVisible();
  await page.getByRole("button", { name: "Approve all" }).click();

  await vi.waitFor(() =>
    expect(answered).toEqual([
      ["first", "accept"],
      ["second", "accept"],
    ]),
  );
});

it("denies every live request", async () => {
  const onRespondToApproval = vi.fn(async () => undefined);
  await using _screen = await render(
    <ComposerPendingApprovalGroup
      approvals={approvals}
      respondingRequestIds={[]}
      disabled={false}
      onRespondToApproval={onRespondToApproval}
    />,
  );

  await page.getByRole("button", { name: "Deny all" }).click();

  await vi.waitFor(() =>
    expect(onRespondToApproval.mock.calls).toEqual([
      ["first", "decline"],
      ["second", "decline"],
    ]),
  );
});

it("answers one request from the expanded list", async () => {
  const onRespondToApproval = vi.fn(async () => undefined);
  await using _screen = await render(
    <ComposerPendingApprovalGroup
      approvals={approvals}
      respondingRequestIds={[]}
      disabled={false}
      onRespondToApproval={onRespondToApproval}
    />,
  );

  await page.getByRole("button", { name: "3 approvals" }).click();
  await expect.element(page.getByText("git status")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).nth(1).click();

  expect(onRespondToApproval.mock.calls).toEqual([["second", "accept"]]);
});

it("marks Approve all with the warnings it would accept", async () => {
  const warning = "Runs outside the workspace";
  await using _screen = await render(
    <ComposerPendingApprovalGroup
      approvals={[
        approval("plain", "ls"),
        approval("warned", "cat /etc/hosts", {
          options: [
            { decision: "decline", label: "Decline" },
            { decision: "accept", label: "Approve", warning },
          ],
        }),
      ]}
      respondingRequestIds={[]}
      disabled={false}
      onRespondToApproval={async () => undefined}
    />,
  );

  await expect
    .element(page.getByRole("button", { name: "Approve all" }))
    .toHaveAttribute("aria-description", warning);
});
