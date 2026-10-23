import { createElement } from "react";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_NOTIFICATION_HISTORY,
  NOTIFICATION_HISTORY_LIMIT,
  attentionToastOptions,
  markNotificationsRead,
  notificationText,
  recordNotification,
  unreadNotificationCount,
  type NotificationEntry,
} from "./toastHistory.logic";

const entry = (toastId: string, overrides: Partial<NotificationEntry> = {}): NotificationEntry => ({
  toastId,
  level: "warning",
  title: `Title ${toastId}`,
  description: "",
  at: "2026-10-23T10:00:00.000Z",
  environmentId: null,
  threadId: null,
  ...overrides,
});

describe("recordNotification", () => {
  it("puts the newest notification first", () => {
    const history = recordNotification(
      recordNotification(EMPTY_NOTIFICATION_HISTORY, entry("a")),
      entry("b"),
    );
    expect(history.entries.map((item) => item.toastId)).toEqual(["b", "a"]);
  });

  it("replaces a toast that changed and moves it to the top", () => {
    const first = recordNotification(
      recordNotification(EMPTY_NOTIFICATION_HISTORY, entry("a")),
      entry("b"),
    );
    const updated = recordNotification(first, entry("a", { level: "error", title: "Failed" }));
    expect(updated.entries.map((item) => [item.toastId, item.level])).toEqual([
      ["a", "error"],
      ["b", "warning"],
    ]);
  });

  it("returns the same history when the toast did not change", () => {
    const history = recordNotification(EMPTY_NOTIFICATION_HISTORY, entry("a"));
    expect(recordNotification(history, entry("a", { at: "2026-10-23T11:00:00.000Z" }))).toBe(
      history,
    );
  });

  it("keeps only the most recent notifications", () => {
    let history = EMPTY_NOTIFICATION_HISTORY;
    for (let index = 0; index < NOTIFICATION_HISTORY_LIMIT + 5; index += 1) {
      history = recordNotification(history, entry(`t${index}`));
    }
    expect(history.entries).toHaveLength(NOTIFICATION_HISTORY_LIMIT);
    expect(history.entries[0]?.toastId).toBe(`t${NOTIFICATION_HISTORY_LIMIT + 4}`);
  });

  it("shortens a very long description", () => {
    const history = recordNotification(
      EMPTY_NOTIFICATION_HISTORY,
      entry("a", { description: "x".repeat(5000) }),
    );
    expect(history.entries[0]!.description.length).toBeLessThanOrEqual(2000);
  });
});

describe("unread notifications", () => {
  it("counts notifications that arrived after the list was last read", () => {
    const history = recordNotification(
      recordNotification(EMPTY_NOTIFICATION_HISTORY, entry("a")),
      entry("b", { at: "2026-10-23T12:00:00.000Z" }),
    );
    expect(unreadNotificationCount(history)).toBe(2);
    const read = markNotificationsRead(history, "2026-10-23T11:00:00.000Z");
    expect(unreadNotificationCount(read)).toBe(1);
    expect(unreadNotificationCount(markNotificationsRead(read, "2026-10-23T12:00:00.000Z"))).toBe(
      0,
    );
  });
});

describe("notificationText", () => {
  it("flattens strings, numbers, arrays and elements into plain text", () => {
    expect(
      notificationText([
        "Update ",
        2,
        createElement("strong", null, " providers  ready"),
        null,
        false,
      ]),
    ).toBe("Update 2 providers ready");
  });

  it("returns an empty string for nothing", () => {
    expect(notificationText(undefined)).toBe("");
  });
});

describe("attentionToastOptions", () => {
  it("keeps a warning or error on screen for at least ten seconds", () => {
    expect(attentionToastOptions({ type: "warning", timeout: undefined }).timeout).toBe(10_000);
    expect(attentionToastOptions({ type: "error", timeout: 4000 }).timeout).toBe(10_000);
    expect(attentionToastOptions({ type: "error", timeout: 15_000 }).timeout).toBe(15_000);
    expect(
      attentionToastOptions({ type: "warning", data: { dismissAfterVisibleMs: 3000 } }).data,
    ).toEqual({ dismissAfterVisibleMs: 10_000 });
  });

  it("leaves a sticky toast sticky", () => {
    expect(attentionToastOptions({ type: "warning", timeout: 0 }).timeout).toBe(0);
  });

  it("keeps a sticky toast sticky when an update brings no timeout", () => {
    expect(attentionToastOptions({ type: "error", timeout: undefined }, 0).timeout).toBeUndefined();
    expect(attentionToastOptions({ type: "error", timeout: undefined }, 5000).timeout).toBe(10_000);
  });

  it("leaves info and success toasts alone", () => {
    const info = { type: "info", timeout: 3000 };
    expect(attentionToastOptions(info)).toBe(info);
    const untyped = { title: "Saved", timeout: 3000 };
    expect(attentionToastOptions(untyped)).toBe(untyped);
  });
});
