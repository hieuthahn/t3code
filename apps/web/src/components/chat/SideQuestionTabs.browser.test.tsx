import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  threads: [] as unknown[],
  navigate: null as unknown as ReturnType<typeof vi.fn>,
  archive: null as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useQuietThreadShells: (() => state.threads) as never,
}));

vi.mock(import("../../state/use-orchestration-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOrchestrationCommand: (() => state.archive) as never,
}));

vi.mock(import("@tanstack/react-router"), async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: (() => state.navigate) as never,
}));

import { makeThreadFixture } from "../../test-fixtures";
import { render } from "../../../test/render";
import { toastManager } from "../ui/toast";
import { SideQuestionTabs } from "./SideQuestionTabs";

const environmentId = EnvironmentId.make("environment-test");
const main = makeThreadFixture({ id: ThreadId.make("thread-main"), title: "Ship the release" });
const sideQuestion = (id: string, title: string, createdAt: string) => ({
  ...makeThreadFixture({
    id: ThreadId.make(id),
    title,
    lineage: {
      rootThreadId: main.id,
      parentThreadId: main.id,
      relationshipToParent: "fork",
      sideQuestion: true,
    },
  }),
  createdAt,
});
const why = sideQuestion("thread-why", "Why did CI fail?", "2026-01-01T00:01:00.000Z");
const where = sideQuestion("thread-where", "Where is the config?", "2026-01-01T00:02:00.000Z");

function setup(threads: unknown[]) {
  state.threads = threads;
  state.navigate = vi.fn(async () => undefined);
  state.archive = vi.fn(async () => ({ _tag: "Success", value: { sequence: 1 } }));
}

it("shows the main thread and its side questions as tabs and switches between them", async () => {
  setup([main, why, where]);
  await using screen = await render(
    <SideQuestionTabs environmentId={environmentId} activeThreadId={why.id} />,
  );

  const tabs = screen.getByRole("tab");
  await expect.element(tabs.nth(0)).toHaveTextContent("Ship the release");
  await expect.element(tabs.nth(1)).toHaveTextContent("Why did CI fail?");
  await expect.element(tabs.nth(2)).toHaveTextContent("Where is the config?");
  await expect.element(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect.element(tabs.nth(0)).toHaveAttribute("aria-selected", "false");

  await userEvent.click(screen.getByRole("tab", { name: "Ship the release" }));
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId: main.id },
  });
});

it("closes the open side question by returning to the main tab and archiving it", async () => {
  setup([main, why, where]);
  await using screen = await render(
    <SideQuestionTabs environmentId={environmentId} activeThreadId={why.id} />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Close Why did CI fail?" }));
  await vi.waitFor(() =>
    expect(state.archive).toHaveBeenCalledWith({
      environmentId,
      input: { threadId: why.id },
    }),
  );
  expect(state.navigate).toHaveBeenCalledWith({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId: main.id },
  });
});

it("keeps a side question that is still answering open", async () => {
  setup([
    main,
    {
      ...why,
      runtime: { ...why.runtime, status: "running", activeRunId: "run-live" },
    },
  ]);
  await using screen = await render(
    <SideQuestionTabs environmentId={environmentId} activeThreadId={main.id} />,
  );

  using toast = vi.spyOn(toastManager, "add");

  await userEvent.click(screen.getByRole("button", { name: "Close Why did CI fail?" }));
  await vi.waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Side question is still answering" }),
    ),
  );
  expect(state.archive).not.toHaveBeenCalled();
});

it("shows no tab strip for a thread without side questions", async () => {
  setup([main]);
  await using screen = await render(
    <SideQuestionTabs environmentId={environmentId} activeThreadId={main.id} />,
  );

  await expect.element(screen.getByRole("tablist")).not.toBeInTheDocument();
});
