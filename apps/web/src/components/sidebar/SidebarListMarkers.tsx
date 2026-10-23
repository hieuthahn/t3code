import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRightIcon } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import {
  animateSidebarLayoutChanges,
  settledGroupMarker,
  sidebarMarkerId,
  type SidebarListMarker,
} from "../Sidebar.logic";
import { SIDEBAR_SORTABLE_DRAG_DISABLED } from "./SidebarThreadRow";

function SortableSidebarMarker(props: {
  marker: SidebarListMarker;
  className?: string;
  children?: ReactNode;
  "data-testid"?: string;
}) {
  const { setNodeRef, transform, transition } = useSortable({
    id: sidebarMarkerId(props.marker),
    disabled: SIDEBAR_SORTABLE_DRAG_DISABLED,
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  return (
    <li
      ref={setNodeRef}
      data-thread-selection-safe
      data-testid={props["data-testid"]}
      className={cn("list-none", props.className)}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: props.marker.endsWith("-placeholder") ? "none" : transition,
        visibility: transform?.scaleY === 0 ? "hidden" : undefined,
      }}
    >
      {props.children}
    </li>
  );
}

export function SidebarSectionPlaceholder(props: {
  marker: "active-placeholder" | "settled-placeholder";
  label: string;
  showHint: boolean;
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className="relative mx-0.5 -mb-px h-0"
    >
      {props.showHint ? (
        <div
          className={cn(
            "absolute inset-x-0 top-0 flex h-9 items-center justify-center rounded-md border border-dashed border-sidebar-foreground/25 text-xs text-sidebar-foreground/80",
            props.isDropTarget && "border-primary/40 bg-primary/5 text-primary",
          )}
        >
          {props.label}
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

export function SidebarDragBoundary(props: {
  marker: "pinned-header" | "pinned-divider";
  label: string;
  visible: boolean;
  isDropTarget: boolean;
}) {
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className="pointer-events-none relative mx-0.5 -mb-px h-0"
    >
      {props.visible ? (
        <div className="sidebar-drag-boundary-label absolute inset-x-2 top-1 flex h-4 items-center gap-2">
          <span
            className={cn(
              "shrink-0 text-xs font-medium",
              props.isDropTarget ? "text-primary" : "text-sidebar-foreground/80",
            )}
          >
            {props.label}
          </span>
          <span
            aria-hidden
            className={cn(
              "h-px flex-1",
              props.isDropTarget ? "bg-primary/50" : "bg-sidebar-foreground/25",
            )}
          />
        </div>
      ) : null}
    </SortableSidebarMarker>
  );
}

export function SidebarSectionHeader(props: {
  marker: "working-header" | "snoozed-header" | "settled-header";
  label: string;
  className?: string;
  dragging?: boolean;
  isDropTarget?: boolean;
  toggle: { expanded: boolean; onToggle: () => void };
}) {
  const shelf =
    props.marker === "working-header"
      ? "working"
      : props.marker === "snoozed-header"
        ? "snoozed"
        : "settled";
  const snoozed = shelf === "snoozed";
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid={`sidebar-${props.marker}`}
      className={cn("mx-0.5 h-8", props.className)}
    >
      <CollapsibleSectionHeader
        onClick={props.toggle.onToggle}
        expanded={props.toggle.expanded}
        tone={
          props.isDropTarget ? "accent" : props.dragging ? "emphasized" : snoozed ? "info" : "muted"
        }
        data-testid={`sidebar-${shelf}-shelf-toggle`}
      >
        {props.label}
      </CollapsibleSectionHeader>
    </SortableSidebarMarker>
  );
}

export function SidebarSettledGroupHeader(props: {
  groupId: string;
  label: string;
  threadCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <SortableSidebarMarker
      marker={settledGroupMarker(props.groupId)}
      data-testid="sidebar-settled-group-header"
      className="mx-0.5 h-8"
    >
      <CollapsibleSectionHeader
        onClick={props.onToggle}
        expanded={props.expanded}
        tone="emphasized"
        accessory={
          <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground/60">
            {props.threadCount}
          </span>
        }
      >
        <span className="block max-w-40 truncate">{props.label}</span>
      </CollapsibleSectionHeader>
    </SortableSidebarMarker>
  );
}

export function SidebarFanoutGroupHeader(props: {
  marker: SidebarListMarker;
  label: string;
  memberCount: number;
  expanded: boolean;
  onToggle: () => void;
  onSelectMembers: () => void;
}) {
  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) props.onSelectMembers();
    else props.onToggle();
  };
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid="sidebar-fanout-group-header"
      className="mx-0.5"
    >
      <button
        type="button"
        aria-expanded={props.expanded}
        onClick={handleClick}
        className="flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-left text-sm text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-sidebar-muted-foreground transition-transform motion-reduce:transition-none",
            props.expanded && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium">{props.label}</span>
        <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
          <span aria-hidden>×{props.memberCount}</span>
          <span className="sr-only">{props.memberCount} models</span>
        </span>
      </button>
    </SortableSidebarMarker>
  );
}
