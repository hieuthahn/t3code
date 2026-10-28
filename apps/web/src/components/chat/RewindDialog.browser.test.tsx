import { MessageId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { fakeTimers, render } from "../../../test/render";
import { RewindDialog } from "./RewindDialog";
import type { RewindEntry } from "./rewindDialog.logic";

const NOW = Date.parse("2026-06-20T12:00:00.000Z");

const entries: ReadonlyArray<RewindEntry> = [
  {
    messageId: MessageId.make("user-2"),
    turnCount: 1,
    preview: "add a test",
    createdAt: "2026-06-20T11:55:00.000Z",
  },
  {
    messageId: MessageId.make("user-1"),
    turnCount: 0,
    preview: "fix the login bug",
    createdAt: "2026-06-20T09:00:00.000Z",
  },
];

function renderDialog(overrides: Partial<Parameters<typeof RewindDialog>[0]> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  return {
    onSelect,
    onClose,
    screen: render(
      <RewindDialog
        open
        entries={entries}
        unavailableReason={null}
        onSelect={onSelect}
        onClose={onClose}
        {...overrides}
      />,
      { router: false },
    ),
  };
}

describe("RewindDialog", () => {
  it("shows the title, subtitle, prompts, and relative times", async () => {
    using _clock = fakeTimers({ now: NOW });
    const { screen } = renderDialog();
    await using _screen = await screen;

    await expect.element(page.getByRole("heading", { name: "Rewind" })).toBeVisible();
    await expect
      .element(page.getByText("Restore the session to an earlier message."))
      .toBeVisible();
    await expect.element(page.getByText("add a test")).toBeVisible();
    await expect.element(page.getByText("fix the login bug")).toBeVisible();
    await expect.element(page.getByText("5m ago")).toBeVisible();
    await expect.element(page.getByText("3h ago")).toBeVisible();
  });

  it("selects the revert target of the clicked prompt", async () => {
    using _clock = fakeTimers({ now: NOW });
    const { screen, onSelect } = renderDialog();
    await using _screen = await screen;

    await page.getByText("fix the login bug").click();

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(0, "user-1");
  });

  it("closes on Escape", async () => {
    using _clock = fakeTimers({ now: NOW });
    const { screen, onClose } = renderDialog();
    await using _screen = await screen;

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("shows the reason instead of actions when the thread cannot revert", async () => {
    using _clock = fakeTimers({ now: NOW });
    const { screen } = renderDialog({ unavailableReason: "Interrupt the current turn first." });
    await using _screen = await screen;

    await expect.element(page.getByText("Interrupt the current turn first.")).toBeVisible();
    expect(page.getByText("add a test").elements()).toHaveLength(0);
  });

  it("says so when there is nothing to rewind to", async () => {
    using _clock = fakeTimers({ now: NOW });
    const { screen } = renderDialog({ entries: [] });
    await using _screen = await screen;

    await expect.element(page.getByText("No earlier messages.")).toBeVisible();
  });
});
