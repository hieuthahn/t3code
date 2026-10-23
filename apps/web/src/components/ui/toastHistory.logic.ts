import * as Schema from "effect/Schema";
import { isValidElement, type ReactNode } from "react";

export const NOTIFICATION_HISTORY_LIMIT = 200;
const DESCRIPTION_MAX_LENGTH = 2000;
const ATTENTION_MIN_MS = 10_000;

const NotificationEntrySchema = Schema.Struct({
  toastId: Schema.String,
  level: Schema.Literals(["error", "warning", "success", "info"]),
  title: Schema.String,
  description: Schema.String,
  at: Schema.String,
  environmentId: Schema.NullOr(Schema.String),
  threadId: Schema.NullOr(Schema.String),
});
export type NotificationEntry = typeof NotificationEntrySchema.Type;
export type NotificationLevel = NotificationEntry["level"];

export const NotificationHistorySchema = Schema.Struct({
  entries: Schema.Array(NotificationEntrySchema),
  readAt: Schema.NullOr(Schema.String),
});
export type NotificationHistory = typeof NotificationHistorySchema.Type;

export const EMPTY_NOTIFICATION_HISTORY: NotificationHistory = { entries: [], readAt: null };

/** Put a toast at the top of the history, replacing an earlier record of the same toast. */
export function recordNotification(
  history: NotificationHistory,
  entry: NotificationEntry,
): NotificationHistory {
  const description =
    entry.description.length > DESCRIPTION_MAX_LENGTH
      ? `${entry.description.slice(0, DESCRIPTION_MAX_LENGTH - 1)}…`
      : entry.description;
  const previous = history.entries.find((item) => item.toastId === entry.toastId);
  if (
    previous !== undefined &&
    previous.level === entry.level &&
    previous.title === entry.title &&
    previous.description === description
  ) {
    return history;
  }
  return {
    ...history,
    entries: [
      { ...entry, description },
      ...history.entries.filter((item) => item.toastId !== entry.toastId),
    ].slice(0, NOTIFICATION_HISTORY_LIMIT),
  };
}

/** Count the notifications that arrived after the list was last read. */
export function unreadNotificationCount(history: NotificationHistory): number {
  const { readAt } = history;
  return readAt === null
    ? history.entries.length
    : history.entries.filter((item) => item.at > readAt).length;
}

/** Mark every notification up to `now` as read. */
export function markNotificationsRead(
  history: NotificationHistory,
  now: string,
): NotificationHistory {
  return { ...history, readAt: now };
}

/** Flatten a toast title or description into plain text. */
export function notificationText(node: ReactNode): string {
  const collect = (value: ReactNode): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(collect).join("");
    if (isValidElement<{ children?: ReactNode }>(value)) return collect(value.props.children);
    return "";
  };
  return collect(node).replace(/\s+/g, " ").trim();
}

/**
 * Keep a warning or error toast up for at least ten seconds, leaving sticky toasts sticky.
 * Pass the toast's current timeout for an update, where an absent timeout keeps the old one.
 */
export function attentionToastOptions<
  T extends {
    readonly type?: string | undefined;
    readonly timeout?: number | undefined;
    readonly data?: { readonly dismissAfterVisibleMs?: number | undefined } | undefined;
  },
>(options: T, previousTimeout?: number): T {
  if (options.type !== "warning" && options.type !== "error") return options;
  const atLeastAttention = (ms: number | undefined) =>
    ms === undefined || ms <= 0 ? ms : Math.max(ms, ATTENTION_MIN_MS);
  const visibleMs = options.data?.dismissAfterVisibleMs;
  return {
    ...options,
    ...(options.timeout === undefined && previousTimeout === 0
      ? {}
      : {
          timeout:
            options.timeout === undefined
              ? Math.max(previousTimeout ?? 0, ATTENTION_MIN_MS)
              : atLeastAttention(options.timeout),
        }),
    ...(options.data === undefined || visibleMs === undefined
      ? {}
      : { data: { ...options.data, dismissAfterVisibleMs: atLeastAttention(visibleMs) } }),
  };
}
