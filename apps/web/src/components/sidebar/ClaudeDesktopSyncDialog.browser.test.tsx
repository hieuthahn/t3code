import type { ClaudeDesktopSyncItem, ClaudeDesktopSyncPreview } from "@t3tools/contracts";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import {
  ClaudeDesktopSyncDialog,
  describeApply,
  type SyncOutcome,
  type SyncSession,
} from "./ClaudeDesktopSyncDialog";
import type { SyncSide } from "./claudeDesktopSyncGroups";

const item = (
  id: string,
  kind: ClaudeDesktopSyncItem["kind"],
  extra: Partial<ClaudeDesktopSyncItem> = {},
): ClaudeDesktopSyncItem => ({
  id,
  kind,
  title: id,
  detail: "Last active 2 days ago",
  selectedByDefault: kind !== "conflict" && !kind.startsWith("suggest"),
  ...extra,
});

const PREVIEW: ClaudeDesktopSyncPreview = {
  desktopSessionCount: 42,
  t3ThreadCount: 38,
  pendingDesktopOpCount: 0,
  canUndo: true,
  items: [
    item("Fix login bug", "conflict", {
      conflictField: "title",
      desktopValue: "Fix login bug v2",
      t3Value: "Login bug fix",
    }),
    item("Refactor sidebar", "importToT3"),
    item("Panda quick wins", "renameT3", { detail: "Renamed to Panda quick wins" }),
    item("Token saver", "createInDesktop"),
    item("Old spike", "suggestArchiveDesktop"),
    item("Empty session", "skip", { detail: "No messages" }),
  ],
};

function Harness(props: {
  readonly onApply?: (items: ReadonlyArray<ClaudeDesktopSyncItem>) => void;
  readonly outcome?: SyncOutcome | null;
  readonly applying?: boolean;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set(PREVIEW.items.filter((entry) => entry.selectedByDefault).map((entry) => entry.id)),
  );
  const [sides, setSides] = useState<ReadonlyMap<string, SyncSide>>(new Map());
  const session: SyncSession = {
    close: () => {},
    phase: { kind: "ready", preview: PREVIEW },
    refreshing: false,
    refresh: async () => {},
    selected,
    setSelected,
    sides,
    setSides,
    pending: props.applying === true ? { kind: "applying", count: 3 } : null,
    outcome: props.outcome ?? null,
    dismissOutcome: () => {},
    apply: async (items) => props.onApply?.(items),
    undo: async () => {},
  };
  return <ClaudeDesktopSyncDialog session={session} />;
}

async function shoot(name: string) {
  if (import.meta.env.VITE_SYNC_DIALOG_SHOTS === undefined) return;
  await page.viewport(960, 820);
  for (const theme of ["light", "dark"] as const) {
    document.documentElement.classList.toggle("dark", theme === "dark");
    await page.screenshot({
      path: `${import.meta.env.VITE_SYNC_DIALOG_SHOTS}/${name}-${theme}.png`,
    });
  }
  document.documentElement.classList.remove("dark");
}

describe("ClaudeDesktopSyncDialog", () => {
  it("groups changes by direction and counts them in the filter", async () => {
    await using _screen = await render(<Harness />);
    await shoot("grouped");

    const headings = [...document.querySelectorAll("section h3")].map((node) => node.textContent);
    expect(headings).toEqual([
      "Needs your choice",
      "Into T3",
      "Into Claude Desktop",
      "Suggested archives",
    ]);
    await expect
      .element(page.getByRole("button", { name: "Into T3, 2", exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("Empty session")).not.toBeVisible();
    await expect.element(page.getByText("1 session skipped")).toBeVisible();
  });

  it("filters to one direction", async () => {
    await using _screen = await render(<Harness />);
    await userEvent.click(
      page.getByRole("button", { name: "Into Claude Desktop, 1", exact: true }),
    );
    const headings = [...document.querySelectorAll("section h3")].map((node) => node.textContent);
    expect(headings).toEqual(["Into Claude Desktop"]);
  });

  it("selects a whole group and a row from anywhere on it", async () => {
    await using _screen = await render(<Harness />);
    await expect.element(page.getByRole("button", { name: "Apply 3" })).toBeVisible();

    await userEvent.click(page.getByRole("checkbox", { name: "Select all in Into T3" }));
    await expect.element(page.getByRole("button", { name: "Apply 1" })).toBeVisible();

    await userEvent.click(page.getByText("Old spike"));
    await expect.element(page.getByRole("button", { name: "Apply 2" })).toBeVisible();
  });

  it("counts a conflict only after a side is picked", async () => {
    const onApply = vi.fn();
    await using _screen = await render(<Harness onApply={onApply} />);
    await expect.element(page.getByText("1 conflict needs a side")).toBeVisible();

    await userEvent.click(page.getByText("Login bug fix"));
    await expect.element(page.getByRole("button", { name: "Apply 4" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Apply 4" }));
    expect(onApply.mock.calls[0]?.[0].map((entry: ClaudeDesktopSyncItem) => entry.id)).toContain(
      "Fix login bug",
    );
  });

  it("shows progress while applying and the result at the top afterwards", async () => {
    await using screen = await render(<Harness applying />);
    await shoot("applying");
    await expect.element(page.getByText("Applying 3 changes…")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Applying…" })).toBeDisabled();

    await screen.rerender(
      <Harness
        outcome={describeApply(
          {
            runId: "r",
            applied: 2,
            queuedForDesktop: 1,
            failed: [{ id: "Token saver", error: "Session is locked" }],
          },
          (id) => id,
        )}
      />,
    );
    await shoot("outcome");
    await expect.element(page.getByText("Synced 2, 1 failed")).toBeVisible();
    await expect.element(page.getByText("Token saver: Session is locked")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  });
});

describe("describeApply", () => {
  it("names a clean run, a partial run and a failed run", () => {
    const base = { runId: "r", queuedForDesktop: 0 };
    expect(describeApply({ ...base, applied: 3, failed: [] }, (id) => id)).toEqual({
      tone: "success",
      title: "Synced 3 changes",
      lines: [],
    });
    expect(
      describeApply({ ...base, applied: 0, failed: [{ id: "x", error: "boom" }] }, () => "X").tone,
    ).toBe("error");
    expect(
      describeApply({ ...base, applied: 1, failed: [{ id: "x", error: "boom" }] }, () => "X"),
    ).toEqual({ tone: "warning", title: "Synced 1, 1 failed", lines: ["X: boom"] });
  });
});
