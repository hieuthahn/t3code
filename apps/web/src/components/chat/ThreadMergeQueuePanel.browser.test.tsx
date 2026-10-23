import {
  EnvironmentId,
  MergeQueueItemId,
  ThreadId,
  type MergeQueueItem,
  type MergeQueueView,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  allowed: true,
  view: null as MergeQueueView | null,
  approve: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock(import("../../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => state.allowed,
  readEnvironmentScope: () => state.allowed,
}));
// The panel reads the approve permission through an atom; the grant is the boundary under test.
vi.mock(import("@effect/atom-react"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomValue: (() => state.allowed) as never,
}));
vi.mock(import("../../state/use-atom-command"), async (importOriginal) => {
  const { serverEnvironment } = await import("../../state/server");
  return {
    ...(await importOriginal()),
    useAtomCommand: ((command: unknown) =>
      command === serverEnvironment.approveMergeQueueItem ? state.approve : state.cancel) as never,
  };
});
vi.mock(import("../../state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuery: (() => ({ data: state.view, error: null })) as never,
}));

import { act, render as renderUi } from "../../../test/render";
import { ThreadMergeQueuePanel } from "./ThreadMergeQueuePanel";

const environmentId = EnvironmentId.make("local");
const ownerThreadId = ThreadId.make("thread:owner");

const item = (overrides: Partial<MergeQueueItem>): MergeQueueItem => ({
  id: MergeQueueItemId.make("merge-queue:api"),
  projectId: "project" as MergeQueueItem["projectId"],
  trunkRef: "main",
  ownerThreadId,
  childThreadId: ThreadId.make("thread:api"),
  childTitle: "API endpoints",
  childBranch: "t3/api",
  headShaAtEnqueue: "abc1234def",
  status: "awaiting_user",
  approvedBy: null,
  gateRuns: [],
  mergedSha: null,
  failure: null,
  enqueuedAt: "2026-10-24T00:00:00.000Z",
  updatedAt: "2026-10-24T00:00:00.000Z",
  ...overrides,
});

async function setup(view: MergeQueueView | null) {
  state.allowed = true;
  state.view = view;
  state.approve.mockReset().mockResolvedValue({ _tag: "Success" });
  state.cancel.mockReset().mockResolvedValue({ _tag: "Success" });

  await using stack = new AsyncDisposableStack();
  const screen = stack.use(await renderUi(null));
  const container = screen.container;
  await act(
    async () =>
      await screen.rerender(
        <ThreadMergeQueuePanel environmentId={environmentId} threadId={ownerThreadId} />,
      ),
  );
  const byLabel = (label: string) =>
    container.querySelector<HTMLElement>(`[aria-label="${label}"]`);

  const environment = stack.move();
  return { container, byLabel, [Symbol.asyncDispose]: () => environment.disposeAsync() };
}

it("shows nothing for a thread with no queued children", async () => {
  await using fixture = await setup({ ownerThreadId, trunks: [], items: [] });
  expect(fixture.container.querySelector("[data-thread-merge-queue-panel]")).toBeNull();
});

it("approves the exact commit the user saw", async () => {
  await using fixture = await setup({
    ownerThreadId,
    trunks: [{ trunkRef: "main", head: "f00", movedOutsideQueue: false }],
    items: [item({})],
  });
  expect(fixture.container.textContent).toContain("waiting for approval at abc1234");
  await act(async () => fixture.byLabel("Approve merging API endpoints at abc1234")!.click());
  expect(state.approve).toHaveBeenCalledWith({
    environmentId,
    input: { itemId: MergeQueueItemId.make("merge-queue:api"), headSha: "abc1234def" },
  });
});

it("refuses to approve without permission", async () => {
  await using fixture = await setup({ ownerThreadId, trunks: [], items: [item({})] });
  state.allowed = false;
  await act(async () => fixture.byLabel("Approve merging API endpoints at abc1234")!.click());
  expect(state.approve).not.toHaveBeenCalled();
});

it("shows why an item failed and lets the user remove it", async () => {
  await using fixture = await setup({
    ownerThreadId,
    trunks: [],
    items: [
      item({
        status: "failed",
        failure: { stage: "gate", message: 'The gate "unit tests" exited with 3' },
      }),
    ],
  });
  const row = fixture.container.querySelector('[data-merge-queue-status="failed"]');
  expect(row?.textContent).toContain("gate failed");
  expect(fixture.byLabel("Approve merging API endpoints at abc1234")).toBeNull();
  await act(async () => fixture.byLabel("Remove API endpoints from the merge queue")!.click());
  expect(state.cancel).toHaveBeenCalledWith({
    environmentId,
    input: { itemId: MergeQueueItemId.make("merge-queue:api") },
  });
});

it("warns when the trunk changed outside the queue", async () => {
  await using fixture = await setup({
    ownerThreadId,
    trunks: [{ trunkRef: "main", head: "f00", movedOutsideQueue: true }],
    items: [item({ status: "merged", mergedSha: "e11" })],
  });
  expect(fixture.container.querySelector('[role="status"]')?.textContent).toContain(
    "main changed outside the queue",
  );
  expect(fixture.byLabel("Remove API endpoints from the merge queue")).toBeNull();
});
