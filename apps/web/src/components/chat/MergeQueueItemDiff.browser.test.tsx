import { EnvironmentId, MergeQueueItemId, type MergeQueueDiff } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  diff: null as MergeQueueDiff | null,
  error: null as string | null,
}));
vi.mock(import("../../state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuery: (() => ({ data: state.diff, error: state.error })) as never,
}));

import { act, render as renderUi } from "../../../test/render";
import { MergeQueueItemDiff } from "./MergeQueueItemDiff";

const environmentId = EnvironmentId.make("local");
const itemId = MergeQueueItemId.make("merge-queue:api");

const diff = (overrides: Partial<MergeQueueDiff>): MergeQueueDiff => ({
  itemId,
  baseSha: "base1234",
  headSha: "head1234",
  files: [
    { path: "api.txt", additions: 2, deletions: 1 },
    { path: "logo.png", additions: null, deletions: null },
  ],
  patch: "diff --git a/api.txt b/api.txt\n@@ -1 +1,2 @@\n-retry\n+retry once\n+retry twice\n",
  truncated: false,
  ...overrides,
});

async function setup(input: { readonly diff: MergeQueueDiff | null; readonly error?: string }) {
  state.diff = input.diff;
  state.error = input.error ?? null;
  const screen = await renderUi(null);
  await act(
    async () =>
      await screen.rerender(
        <MergeQueueItemDiff environmentId={environmentId} itemId={itemId} headSha="head1234" />,
      ),
  );
  return screen;
}

it("sums up the changes and opens the patch on request", async () => {
  await using screen = await setup({ diff: diff({}) });
  const toggle = screen.container.querySelector<HTMLElement>('[aria-label="Review the changes"]');
  expect(toggle?.textContent).toContain("2 files · +2 −1");
  expect(screen.container.querySelector("[data-diff-line]")).toBeNull();

  await act(async () => toggle!.click());
  const text = screen.container.textContent ?? "";
  expect(text).toContain("api.txt");
  expect(text).toContain("logo.png");
  expect(text).toContain("binary");
  const added = [...screen.container.querySelectorAll('[data-diff-line="add"]')].map(
    (line) => line.textContent,
  );
  expect(added).toEqual(["+retry once", "+retry twice"]);
  expect(screen.container.querySelector('[data-diff-line="delete"]')?.textContent).toBe("-retry");
});

it("says when the patch was cut short", async () => {
  await using screen = await setup({ diff: diff({ truncated: true }) });
  await act(async () =>
    screen.container.querySelector<HTMLElement>('[aria-label="Review the changes"]')!.click(),
  );
  expect(screen.container.textContent).toContain("The patch is cut short");
});

it("reports a diff that could not load", async () => {
  await using screen = await setup({ diff: null, error: "The child's worktree is gone." });
  expect(screen.container.textContent).toContain("The child's worktree is gone.");
  expect(screen.container.querySelector('[aria-label="Review the changes"]')).toBeNull();
});
