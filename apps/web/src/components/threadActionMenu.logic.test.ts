import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  canOpenInSplitView: true,
  canOpenSideChat: true,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "side-chat",
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "side-chat",
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables archive while the thread is running", () => {
    const archiveItem = buildThreadActionMenuItems({ ...baseState, isRunning: true }).find(
      (item) => item.id === "archive",
    );
    expect(archiveItem?.disabled).toBe(true);
  });

  it("offers Open in > Split view", () => {
    const item = buildThreadActionMenuItems(baseState).find((entry) => entry.id === "open-in");
    expect(item?.children?.map((child) => child.id)).toEqual(["open-in:split"]);
  });

  it("omits Open in where the thread already fills a pane", () => {
    const items = buildThreadActionMenuItems({ ...baseState, canOpenInSplitView: false });
    expect(items.some((entry) => entry.id === "open-in")).toBe(false);
  });

  it("keeps Open in available to read-only clients", () => {
    const items = buildThreadActionMenuItems({ ...baseState, canOperate: false });
    const item = items.find((entry) => entry.id === "open-in");
    expect(item?.disabled).toBeUndefined();
    expect(item?.children?.every((child) => child.disabled === undefined)).toBe(true);
  });

  it("offers a side chat once the thread has a turn, and never to a read-only connection", () => {
    const ids = (state: ThreadActionMenuState) =>
      buildThreadActionMenuItems(state).map((item) => item.id);
    expect(ids(baseState)).toContain("side-chat");
    expect(ids({ ...baseState, canOpenSideChat: false })).not.toContain("side-chat");
    expect(
      buildThreadActionMenuItems({ ...baseState, canOperate: false }).find(
        (item) => item.id === "side-chat",
      )?.disabled,
    ).toBe(true);
  });
});
