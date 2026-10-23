import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import type { ComponentProps } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  projection: null as unknown,
  workflow: null as unknown,
  dispatched: [] as Array<{ readonly command: unknown; readonly value: unknown }>,
}));

vi.mock(import("@t3tools/client-runtime/state/thread-workflows"), async (importOriginal) => ({
  ...(await importOriginal()),
  deriveThreadQueueWorkflowState: (() => state.workflow) as never,
}));

vi.mock(import("../../state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useThreadProjection: (() => state.projection) as never,
}));

vi.mock(import("../../state/use-atom-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomCommand: ((command: unknown) => async (value: unknown) => {
    state.dispatched.push({ command, value });
  }) as never,
}));

vi.mock(import("../../assets/assetUrls"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAssetUrls: ((_environmentId: never, resources: ReadonlyArray<{ attachmentId: string }>) =>
    resources.map((resource) => `https://assets.test/${resource.attachmentId}`)) as never,
}));

import { threadEnvironment } from "../../state/threads";
import { render as renderUi } from "../../../test/render";
import { QueuedRunsControl } from "./QueuedRunsControl";

function setup() {
  state.projection = null;
  state.workflow = null;
  state.dispatched = [];
}

const queuedRun = {
  run: { id: "run:queued", userMessageId: "message:queued" },
  text: "Rename the helper",
  attachments: [],
};

const baseProps = {
  environmentId: "environment:test" as never,
  optimisticMessages: [],
  threadId: "thread:test" as never,
  editingRunId: null,
  onEditQueuedRun: () => undefined,
  onCancelEdit: () => undefined,
} satisfies ComponentProps<typeof QueuedRunsControl>;

async function renderQueue(props: Partial<ComponentProps<typeof QueuedRunsControl>> = {}) {
  return renderUi(<QueuedRunsControl {...baseProps} {...props} />);
}

it("previews assistant quotes as readable text and preserves the citation when editing", async () => {
  setup();
  const quotedText = "Cache the parsed config per worktree.";
  const quote = serializeAssistantCitation({
    version: 1,
    environmentId: EnvironmentId.make("environment:test"),
    threadId: ThreadId.make("thread:test"),
    messageId: MessageId.make("message:assistant"),
    text: quotedText,
    start: 0,
    end: quotedText.length,
    prefix: "",
    suffix: "",
  });
  const quoteAndText = `${quote}\n\nWhy per worktree?`;
  state.projection = { projection: { messages: [] } };
  state.workflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    canReorder: true,
    queuedRuns: [
      {
        run: { id: "run:quote-only", userMessageId: "message:quote-only" },
        text: quote,
        attachments: [],
      },
      {
        run: { id: "run:quote-and-text", userMessageId: "message:quote-and-text" },
        text: quoteAndText,
        attachments: [],
      },
    ],
  };
  const onEditQueuedRun = vi.fn();
  await using _screen = await renderQueue({ onEditQueuedRun });

  await expect.element(page.getByText(quotedText, { exact: true })).toBeVisible();
  await expect
    .element(page.getByText(`${quotedText} Why per worktree?`, { exact: true }))
    .toBeVisible();

  await page.getByRole("button", { name: "Edit queued message", exact: true }).nth(1).click();
  expect(onEditQueuedRun).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ text: quoteAndText }),
  );
});

it("steers the running turn with a queued message", async () => {
  setup();
  state.projection = { projection: { messages: [] } };
  state.workflow = {
    activeRun: { id: "run:active" },
    canPromoteToSteer: true,
    canReorder: true,
    holdReason: null,
    queuedRuns: [queuedRun],
  };
  await using _screen = await renderQueue();

  await page.getByRole("button", { name: "Steer now" }).click();

  expect(state.dispatched).toEqual([
    {
      command: threadEnvironment.promoteQueuedRun,
      value: {
        environmentId: baseProps.environmentId,
        input: {
          threadId: baseProps.threadId,
          queuedRunId: "run:queued",
          targetRunId: "run:active",
        },
      },
    },
  ]);
});

it("names why a stopped queue waits and resumes the whole queue", async () => {
  setup();
  state.projection = { projection: { messages: [] } };
  state.workflow = {
    activeRun: null,
    canSendNow: true,
    canReorder: true,
    isHeld: true,
    holdReason: "stopped",
    queuedRuns: [queuedRun],
  };
  await using _screen = await renderQueue();

  await expect.element(page.getByText("Paused because the run was stopped")).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();

  expect(state.dispatched).toEqual([
    {
      command: threadEnvironment.resumeThreadQueue,
      value: { environmentId: baseProps.environmentId, input: { threadId: baseProps.threadId } },
    },
  ]);
});

it("offers no resume while a usage limit holds the queue", async () => {
  setup();
  state.projection = { projection: { messages: [] } };
  state.workflow = {
    activeRun: null,
    canSendNow: true,
    canReorder: true,
    isHeld: false,
    holdReason: "usage_limit",
    queuedRuns: [queuedRun],
  };
  await using _screen = await renderQueue();

  await expect.element(page.getByText("Paused until the usage limit resets")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Resume" })).not.toBeInTheDocument();
});
