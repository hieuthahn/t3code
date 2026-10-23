import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef, type ReactNode } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import {
  EMPTY_NOTIFICATION_HISTORY,
  NotificationHistorySchema,
  notificationText,
  recordNotification,
  type NotificationEntry,
  type NotificationLevel,
} from "./toastHistory.logic";

const NOTIFICATION_HISTORY_KEY = "t3code:notification-history:v1";
// Base UI numbers toasts per page load, so a reload would reuse ids already in the history.
const PAGE_LOAD_ID = Math.random().toString(36).slice(2, 10);

interface RecordableToast {
  readonly id: string;
  readonly type?: string | undefined;
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly data?:
    | {
        readonly threadRef?: ScopedThreadRef | null | undefined;
        readonly threadId?: ThreadId | null | undefined;
        readonly tooltipStyle?: boolean | undefined;
      }
    | undefined;
}

export function useNotificationHistory() {
  return useLocalStorage(
    NOTIFICATION_HISTORY_KEY,
    EMPTY_NOTIFICATION_HISTORY,
    NotificationHistorySchema,
  );
}

function levelOf(type: string | undefined): NotificationLevel | null {
  if (type === undefined) return "info";
  return type === "error" || type === "warning" || type === "success" || type === "info"
    ? type
    : null;
}

/** Record every shown toast in the notification history and log warnings and errors. */
export function useRecordToasts(toasts: readonly RecordableToast[]) {
  const [, setHistory] = useNotificationHistory();
  const recordedRef = useRef(new Map<string, string>());
  const record = useStableCallback((shown: readonly RecordableToast[]) => {
    const recorded = recordedRef.current;
    const changed: NotificationEntry[] = [];
    for (const toast of shown) {
      const level = levelOf(toast.type);
      if (level === null || toast.data?.tooltipStyle) continue;
      const title = notificationText(toast.title);
      const description = notificationText(toast.description);
      const signature = `${level}\n${title}\n${description}`;
      if (recorded.get(toast.id) === signature) continue;
      recorded.set(toast.id, signature);
      if (level === "warning") console.warn("[toast]", title, description);
      if (level === "error") console.error("[toast]", title, description);
      changed.push({
        toastId: `${PAGE_LOAD_ID}:${toast.id}`,
        level,
        title,
        description,
        at: new Date().toISOString(),
        environmentId: toast.data?.threadRef?.environmentId ?? null,
        threadId: toast.data?.threadRef?.threadId ?? toast.data?.threadId ?? null,
      });
    }
    const shownIds = new Set(shown.map((toast) => toast.id));
    for (const id of recorded.keys()) if (!shownIds.has(id)) recorded.delete(id);
    if (changed.length === 0) return;
    // Base UI lists the newest toast first; record oldest first so the newest ends on top.
    setHistory((history) => changed.toReversed().reduce(recordNotification, history));
  });
  useEffect(() => record(toasts), [record, toasts]);
}
