import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronRightIcon,
  Columns3Icon,
  FolderIcon,
  GripVerticalIcon,
  PinIcon,
  PinOffIcon,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "~/lib/utils";
import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
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
  "data-kind"?: string;
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
      data-kind={props["data-kind"]}
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

/** Head a compact date group, or a project group when `project` is given (null for Scratch or Other). */
export function SidebarBucketHeader(props: {
  marker: SidebarListMarker;
  label: string;
  threadCount: number;
  expanded: boolean;
  onToggle: () => void;
  project?: ProjectFaviconProject | null | undefined;
  pinned?: boolean | undefined;
  onPinnedChange?: ((pinned: boolean) => void) | undefined;
  onContextMenu?: ((position: { x: number; y: number }) => void) | undefined;
  reorder?:
    | {
        readonly groupId: string;
        readonly dragging: boolean;
        readonly onHandlePointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
        readonly onStep: (step: -1 | 1) => void;
      }
    | undefined;
}) {
  const isProject = props.project !== undefined;
  const canPin = isProject && props.onPinnedChange !== undefined;
  const reorder = isProject ? props.reorder : undefined;
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (reorder === undefined || !event.altKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    reorder.onStep(event.key === "ArrowUp" ? -1 : 1);
  };
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid="sidebar-bucket-header"
      data-kind={isProject ? "project" : "date"}
      className={cn("mx-0.5 h-7", isProject && "not-first:h-9")}
    >
      <div
        data-project-group={reorder?.groupId}
        className={cn("group/bucket relative h-full", reorder?.dragging && "opacity-50")}
        onContextMenu={
          props.onContextMenu === undefined
            ? undefined
            : (event) => {
                event.preventDefault();
                props.onContextMenu?.({ x: event.clientX, y: event.clientY });
              }
        }
      >
        <button
          type="button"
          aria-expanded={props.expanded}
          aria-keyshortcuts={reorder === undefined ? undefined : "Alt+ArrowUp Alt+ArrowDown"}
          onClick={props.onToggle}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex h-full w-full cursor-pointer items-end gap-1.5 rounded-md px-2 pb-1 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            isProject
              ? "font-semibold text-sidebar-foreground"
              : "font-medium text-sidebar-muted-foreground hover:text-sidebar-foreground",
          )}
        >
          {isProject ? (
            <span
              aria-hidden
              className={cn(
                "mb-px flex size-3.5 shrink-0 self-end",
                reorder !== undefined && "transition-opacity group-hover/bucket:opacity-0",
              )}
            >
              {props.project ? (
                <ProjectFavicon project={props.project} className="size-3.5" />
              ) : (
                <FolderIcon className="size-3.5 text-sidebar-muted-foreground" />
              )}
            </span>
          ) : null}
          {isProject ? (
            <Tooltip>
              <TooltipTrigger render={<span className="min-w-0 truncate" />}>
                {props.label}
              </TooltipTrigger>
              <TooltipPopup side="right">{props.label}</TooltipPopup>
            </Tooltip>
          ) : (
            <span>{props.label}</span>
          )}
          {props.pinned ? (
            <PinIcon
              aria-label="Pinned"
              role="img"
              className="mb-px size-3 shrink-0 text-sidebar-muted-foreground"
            />
          ) : null}
          <span
            className={cn(
              "flex items-end gap-1.5",
              isProject && "ms-auto",
              canPin &&
                "transition-opacity group-hover/bucket:opacity-0 group-has-[:focus-visible]/bucket:opacity-0",
            )}
          >
            <span className="tabular-nums font-medium text-sidebar-muted-foreground/60">
              {props.threadCount}
              <span className="sr-only"> threads</span>
            </span>
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "mb-px size-3 shrink-0 text-sidebar-muted-foreground transition-transform motion-reduce:transition-none",
                props.expanded && "rotate-90",
              )}
            />
          </span>
        </button>
        {reorder === undefined ? null : (
          <span
            aria-hidden
            onPointerDown={reorder.onHandlePointerDown}
            className="pointer-events-none absolute inset-y-0 left-0 flex w-6 cursor-grab touch-none items-end justify-center pb-1 text-sidebar-muted-foreground opacity-0 transition-opacity hover:text-sidebar-foreground active:cursor-grabbing group-hover/bucket:pointer-events-auto group-hover/bucket:opacity-100"
          >
            <GripVerticalIcon className="mb-px size-3.5" />
          </span>
        )}
        {canPin ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={props.pinned ? "Unpin project" : "Pin project"}
                  onClick={() => props.onPinnedChange?.(!props.pinned)}
                  className="pointer-events-none absolute inset-y-0 right-0 flex cursor-pointer items-end rounded-md px-2 pb-1 text-sidebar-muted-foreground opacity-0 outline-none transition-opacity hover:text-sidebar-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring group-hover/bucket:pointer-events-auto group-hover/bucket:opacity-100 group-has-[:focus-visible]/bucket:opacity-100"
                />
              }
            >
              {props.pinned ? (
                <PinOffIcon aria-hidden className="mb-px size-3.5" />
              ) : (
                <PinIcon aria-hidden className="mb-px size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipPopup side="top">{props.pinned ? "Unpin project" : "Pin project"}</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
    </SortableSidebarMarker>
  );
}

export function SidebarFanoutGroupHeader(props: {
  marker: SidebarListMarker;
  label: string;
  memberCount: number;
  expanded: boolean;
  compact?: boolean;
  onToggle: () => void;
  onSelectMembers: () => void;
  onCompare: () => void;
}) {
  const handleClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) props.onSelectMembers();
    else props.onToggle();
  };
  return (
    <SortableSidebarMarker
      marker={props.marker}
      data-testid="sidebar-fanout-group-header"
      className="group/fanout-header mx-0.5"
    >
      <div
        className={cn(
          "flex items-center rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-row-hover has-[button:focus-visible]:bg-sidebar-row-hover",
          props.compact ? "h-7" : "h-8",
        )}
      >
        <button
          type="button"
          aria-expanded={props.expanded}
          onClick={handleClick}
          className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-sidebar-muted-foreground transition-transform motion-reduce:transition-none",
              props.expanded && "rotate-90",
            )}
          />
          <span className="min-w-0 flex-1 truncate font-medium">{props.label}</span>
          <span className="shrink-0 pr-1 text-xs tabular-nums text-sidebar-muted-foreground">
            <span aria-hidden>×{props.memberCount}</span>
            <span className="sr-only">{props.memberCount} models</span>
          </span>
        </button>
        <button
          type="button"
          aria-label={`Compare ${props.memberCount} models for ${props.label}`}
          onClick={props.onCompare}
          className="mr-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-sidebar-muted-foreground opacity-0 outline-none transition-opacity group-hover/fanout-header:opacity-100 hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
        >
          <Columns3Icon aria-hidden className="size-3.5" />
        </button>
      </div>
    </SortableSidebarMarker>
  );
}
