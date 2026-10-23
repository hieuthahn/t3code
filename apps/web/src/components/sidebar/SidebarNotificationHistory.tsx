import { useNavigate } from "@tanstack/react-router";
import {
  BellIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useNotificationHistory } from "../ui/toastHistory";
import {
  EMPTY_NOTIFICATION_HISTORY,
  markNotificationsRead,
  unreadNotificationCount,
  type NotificationEntry,
  type NotificationLevel,
} from "../ui/toastHistory.logic";

const LEVEL_ICONS: Record<NotificationLevel, { icon: LucideIcon; className: string }> = {
  error: { icon: CircleAlertIcon, className: "text-destructive" },
  warning: { icon: TriangleAlertIcon, className: "text-warning" },
  success: { icon: CircleCheckIcon, className: "text-success" },
  info: { icon: InfoIcon, className: "text-info" },
};

function NotificationRow(props: {
  entry: NotificationEntry;
  unread: boolean;
  nowMs: number;
  onOpenThread: (entry: NotificationEntry) => void;
}) {
  const { entry } = props;
  const { icon: Icon, className } = LEVEL_ICONS[entry.level];
  return (
    <li className="relative flex gap-2.5 px-3 py-2.5">
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", className)} />
      <div className="min-w-0 flex-1 select-text">
        <p className="text-sm font-medium wrap-break-word text-foreground">
          {entry.title || entry.description}
        </p>
        {entry.title && entry.description ? (
          <p className="mt-0.5 line-clamp-4 text-xs wrap-break-word text-muted-foreground">
            {entry.description}
          </p>
        ) : null}
        {entry.environmentId !== null && entry.threadId !== null ? (
          <button
            type="button"
            onClick={() => props.onOpenThread(entry)}
            className="mt-1 cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Open thread
          </button>
        ) : null}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatRelativeTimeLabel(entry.at, props.nowMs)}
      </span>
      {props.unread ? (
        <span
          aria-label="Unread"
          role="img"
          className="absolute top-3.5 left-1 size-1.5 rounded-full bg-primary"
        />
      ) : null}
    </li>
  );
}

export function SidebarNotificationHistory() {
  const navigate = useNavigate();
  const nowMinute = useNowMinute();
  const [history, setHistory] = useNotificationHistory();
  const [readAtOnOpen, setReadAtOnOpen] = useState<string | null>(null);
  const unread = unreadNotificationCount(history);
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

  const handleOpenChange = (open: boolean) => {
    if (!open) return;
    setReadAtOnOpen(history.readAt);
    setHistory((current) => markNotificationsRead(current, new Date().toISOString()));
  };

  return (
    <SidebarMenuItem className="shrink-0">
      <Popover onOpenChange={handleOpenChange}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={<SidebarMenuButton aria-label={label} size="icon" className="relative" />}
              />
            }
          >
            <BellIcon />
            {unread > 0 ? (
              <span
                aria-hidden
                className="pointer-events-none absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary"
              />
            ) : null}
          </TooltipTrigger>
          <TooltipPopup side="top">Notifications</TooltipPopup>
        </Tooltip>
        <PopoverPopup side="top" align="start" width="md" padding="none">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
            <PopoverTitle>Notifications</PopoverTitle>
            <Button
              size="xs"
              variant="ghost"
              disabled={history.entries.length === 0}
              onClick={() => setHistory(EMPTY_NOTIFICATION_HISTORY)}
            >
              Clear all
            </Button>
          </div>
          {history.entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No notifications yet
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-border/60 overflow-y-auto overscroll-contain">
              {history.entries.map((entry) => (
                <NotificationRow
                  key={entry.toastId}
                  entry={entry}
                  unread={readAtOnOpen === null || entry.at > readAtOnOpen}
                  nowMs={Date.parse(`${nowMinute}:00.000Z`)}
                  onOpenThread={({ environmentId, threadId }) => {
                    if (environmentId === null || threadId === null) return;
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: { environmentId, threadId },
                    });
                  }}
                />
              ))}
            </ul>
          )}
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}
