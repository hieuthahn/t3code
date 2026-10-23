import type { ApprovalResponder } from "@t3tools/client-runtime/state/thread-requests";
import { RuntimeRequestId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
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

const warning = "Runs outside the workspace";
const approvals = [
  approval("first", "pnpm test"),
  approval("second", "cat /etc/hosts", {
    options: [
      { decision: "decline", label: "Decline" },
      { decision: "accept", label: "Approve", warning },
    ],
  }),
  approval("gone", "rm -rf build", { responseCapability: "not_resumable" }),
];

const succeeded = AsyncResult.success(undefined);
const failed = AsyncResult.failure(Cause.fail("rejected"));

async function renderGroup(onRespondToApproval: ApprovalResponder) {
  return render(
    <ComposerPendingApprovalGroup
      approvals={approvals}
      respondingRequestIds={[]}
      disabled={false}
      onRespondToApproval={onRespondToApproval}
    />,
  );
}

it("lists every request and its warning before approving them in order", async () => {
  const onRespondToApproval = vi.fn(async () => succeeded);
  await using _screen = await renderGroup(onRespondToApproval);

  await page.getByRole("button", { name: "Approve all" }).click();

  const confirmation = page.getByRole("group", { name: "Approve 2 requests?" });
  await expect.element(confirmation.getByText("pnpm test")).toBeVisible();
  await expect.element(confirmation.getByText("cat /etc/hosts")).toBeVisible();
  await expect.element(confirmation.getByText(warning)).toBeVisible();
  expect(onRespondToApproval).not.toHaveBeenCalled();

  await confirmation.getByRole("button", { name: "Approve 2" }).click();

  await vi.waitFor(() =>
    expect(onRespondToApproval.mock.calls).toEqual([
      ["first", "accept"],
      ["second", "accept"],
    ]),
  );
});

it("approves nothing when the confirmation is cancelled", async () => {
  const onRespondToApproval = vi.fn(async () => succeeded);
  await using _screen = await renderGroup(onRespondToApproval);

  await page.getByRole("button", { name: "Approve all" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect
    .element(page.getByRole("group", { name: "Approve 2 requests?" }))
    .not.toBeInTheDocument();
  expect(onRespondToApproval).not.toHaveBeenCalled();
});

it("stops at the first approval that fails and says how many went unanswered", async () => {
  const onRespondToApproval = vi.fn(async () => failed);
  await using _screen = await renderGroup(onRespondToApproval);

  await page.getByRole("button", { name: "Approve all" }).click();
  await page.getByRole("button", { name: "Approve 2" }).click();

  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Stopped after a request failed. 2 requests were not answered.");
  expect(onRespondToApproval.mock.calls).toEqual([["first", "accept"]]);
});

it("denies every live request and stops at the first failure", async () => {
  const onRespondToApproval = vi.fn(async (requestId: RuntimeRequestId) =>
    requestId === "first" ? succeeded : failed,
  );
  await using _screen = await renderGroup(onRespondToApproval);

  await page.getByRole("button", { name: "Deny all" }).click();

  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Stopped after a request failed. 1 request was not answered.");
  expect(onRespondToApproval.mock.calls).toEqual([
    ["first", "decline"],
    ["second", "decline"],
  ]);
});

it("answers one request from the expanded list", async () => {
  const onRespondToApproval = vi.fn(async () => succeeded);
  await using _screen = await renderGroup(onRespondToApproval);

  await page.getByRole("button", { name: "3 approvals" }).click();
  await expect.element(page.getByText("pnpm test")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();

  expect(onRespondToApproval.mock.calls).toEqual([["first", "accept"]]);
});
