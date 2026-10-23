import {
  AlarmClockIcon,
  ArchiveIcon,
  CheckIcon,
  EllipsisIcon,
  PinIcon,
  PinOffIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import type { BulkThreadActionId } from "./bulkThreadActions.logic";
import { SidebarHeaderIconButton } from "./SidebarThreadHeader";

export interface SidebarBulkActionBarProps {
  count: number;
  settleToggle: "settle" | "unsettle" | null;
  pinToggle: "pin" | "unpin" | null;
  canSnooze: boolean;
  onAction: (action: BulkThreadActionId) => void;
  onShowMenu: (position: { x: number; y: number }, opts: { snoozeOnly: boolean }) => void;
  onClear: () => void;
}

function menuPositionOf(event: ReactMouseEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 4 };
}

export function SidebarBulkActionBar({
  count,
  settleToggle,
  pinToggle,
  canSnooze,
  onAction,
  onShowMenu,
  onClear,
}: SidebarBulkActionBarProps) {
  if (count === 0) return null;
  const noun = `thread${count === 1 ? "" : "s"}`;
  return (
    <div
      role="toolbar"
      aria-label={`Actions for ${count} selected ${noun}`}
      className="mx-2 mb-1 flex flex-col gap-0.5 rounded-lg border border-sidebar-border bg-sidebar-control-surface p-1 text-sidebar-foreground"
    >
      <div className="flex items-center gap-1 pl-1.5">
        <span
          aria-live="polite"
          className="min-w-0 flex-1 truncate text-xs font-medium tabular-nums"
        >
          {count} selected
        </span>
        <SidebarHeaderIconButton label="Clear selection (Esc)" onClick={onClear}>
          <XIcon />
        </SidebarHeaderIconButton>
      </div>
      <div className="flex items-center justify-between gap-0.5">
        {settleToggle === "settle" ? (
          <SidebarHeaderIconButton
            label={`Settle ${count} ${noun}`}
            onClick={() => onAction("settle")}
          >
            <CheckIcon />
          </SidebarHeaderIconButton>
        ) : settleToggle === "unsettle" ? (
          <SidebarHeaderIconButton
            label={`Un-settle ${count} ${noun}`}
            onClick={() => onAction("unsettle")}
          >
            <Undo2Icon />
          </SidebarHeaderIconButton>
        ) : null}
        {pinToggle === "pin" ? (
          <SidebarHeaderIconButton label={`Pin ${count} ${noun}`} onClick={() => onAction("pin")}>
            <PinIcon />
          </SidebarHeaderIconButton>
        ) : pinToggle === "unpin" ? (
          <SidebarHeaderIconButton
            label={`Unpin ${count} ${noun}`}
            onClick={() => onAction("unpin")}
          >
            <PinOffIcon />
          </SidebarHeaderIconButton>
        ) : null}
        {canSnooze ? (
          <SidebarHeaderIconButton
            label={`Snooze ${count} ${noun}`}
            aria-haspopup="menu"
            onClick={(event) => onShowMenu(menuPositionOf(event), { snoozeOnly: true })}
          >
            <AlarmClockIcon />
          </SidebarHeaderIconButton>
        ) : null}
        <SidebarHeaderIconButton
          label={`Archive ${count} ${noun}`}
          onClick={() => onAction("archive")}
        >
          <ArchiveIcon />
        </SidebarHeaderIconButton>
        <SidebarHeaderIconButton
          label="More actions"
          aria-haspopup="menu"
          onClick={(event) => onShowMenu(menuPositionOf(event), { snoozeOnly: false })}
        >
          <EllipsisIcon />
        </SidebarHeaderIconButton>
      </div>
    </div>
  );
}
