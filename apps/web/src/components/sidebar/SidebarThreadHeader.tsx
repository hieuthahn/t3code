import { FolderPlusIcon, Rows3Icon, SearchIcon, SquarePenIcon, XIcon } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import type { SidebarCompactGroupBy } from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { SidebarInput, SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface SidebarThreadHeaderProps {
  searchFieldRef?: RefObject<HTMLDivElement | null>;
  hasProjects: boolean;
  projectScope: ReactNode;
  compactMode: boolean;
  onCompactModeChange: (compact: boolean) => void;
  compactGroupBy: SidebarCompactGroupBy;
  onCompactGroupByChange: (groupBy: SidebarCompactGroupBy) => void;
  onNewProject: () => void;
  onNewThread: (event: ReactMouseEvent) => void;
  newThreadDisabled: boolean;
  newThreadShortcutLabel: string | null | undefined;
  newThreadInProjectShortcutLabel: string | null | undefined;
  showNewThreadInProjectHint: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isSearching: boolean;
  searchResultCount: number;
  activeSearchResultIndex: number;
  onClearSearch: () => void;
}

export function SidebarThreadHeader({
  searchFieldRef,
  hasProjects,
  projectScope,
  compactMode,
  onCompactModeChange,
  compactGroupBy,
  onCompactGroupByChange,
  onNewProject,
  onNewThread,
  newThreadDisabled,
  newThreadShortcutLabel,
  newThreadInProjectShortcutLabel,
  showNewThreadInProjectHint,
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchKeyDown,
  isSearching,
  searchResultCount,
  activeSearchResultIndex,
  onClearSearch,
}: SidebarThreadHeaderProps) {
  const resultsVisible = isSearching && searchResultCount > 0;
  // Results shrink as the query narrows, so the active index can outrun the
  // list; pointing aria-activedescendant at a removed option strands the
  // screen reader on nothing.
  const activeResultExists = resultsVisible && activeSearchResultIndex < searchResultCount;
  const newThreadLabel = newThreadShortcutLabel
    ? `New thread (${newThreadShortcutLabel})`
    : "New thread";

  return (
    <div className="flex items-center gap-1">
      <div
        ref={searchFieldRef}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
      >
        <SearchIcon className="size-4 shrink-0 text-(--sidebar-icon-color)" />
        <SidebarInput
          ref={searchInputRef}
          nativeInput
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search"
          aria-label="Search threads"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={resultsVisible}
          aria-controls={resultsVisible ? "sidebar-thread-search-results" : undefined}
          aria-activedescendant={
            activeResultExists
              ? `sidebar-thread-search-result-${activeSearchResultIndex}`
              : undefined
          }
          className="min-w-0 flex-1"
        />
        {isSearching ? (
          <Button
            type="button"
            size="icon-micro"
            variant="ghost-muted"
            className="shrink-0"
            aria-label="Clear thread search"
            onClick={() => {
              onClearSearch();
              searchInputRef.current?.focus();
            }}
          >
            <XIcon className="size-3" />
          </Button>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <SidebarViewMenu
          compactMode={compactMode}
          onCompactModeChange={onCompactModeChange}
          compactGroupBy={compactGroupBy}
          onCompactGroupByChange={onCompactGroupByChange}
        />
        {hasProjects ? (
          <>
            {projectScope}
            <SidebarHeaderIconButton label="Add project" onClick={onNewProject}>
              <FolderPlusIcon />
            </SidebarHeaderIconButton>
          </>
        ) : null}
        <SidebarHeaderIconButton
          label="New thread"
          tooltip={
            showNewThreadInProjectHint ? (
              <span className="flex flex-col gap-0.5">
                <span>{newThreadLabel}</span>
                <span className="text-muted-foreground">
                  New thread in current project: Shift+click
                  {newThreadInProjectShortcutLabel ? ` (${newThreadInProjectShortcutLabel})` : ""}
                </span>
              </span>
            ) : (
              newThreadLabel
            )
          }
          disabled={newThreadDisabled}
          onClick={onNewThread}
        >
          <SquarePenIcon />
        </SidebarHeaderIconButton>
      </div>
    </div>
  );
}

function SidebarViewMenu({
  compactMode,
  onCompactModeChange,
  compactGroupBy,
  onCompactGroupByChange,
}: Pick<
  SidebarThreadHeaderProps,
  "compactMode" | "onCompactModeChange" | "compactGroupBy" | "onCompactGroupByChange"
>) {
  return (
    <Menu>
      <SidebarHeaderIconButton label="View options" menuTrigger>
        <Rows3Icon />
      </SidebarHeaderIconButton>
      <MenuPopup align="end" side="bottom" className="min-w-44">
        <MenuGroup>
          <MenuGroupLabel>Density</MenuGroupLabel>
          <MenuRadioGroup
            value={compactMode ? "compact" : "comfortable"}
            onValueChange={(value) => onCompactModeChange(value === "compact")}
          >
            <MenuRadioItem value="comfortable" closeOnClick>
              <span className="flex items-center justify-between gap-2">
                Comfortable
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
            <MenuRadioItem value="compact" closeOnClick>
              <span className="flex items-center justify-between gap-2">
                Compact
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Group by</MenuGroupLabel>
          <MenuRadioGroup
            value={compactGroupBy}
            onValueChange={(value) => {
              if (value === "time" || value === "project") onCompactGroupByChange(value);
            }}
          >
            <MenuRadioItem value="time" disabled={!compactMode} closeOnClick>
              <span className="flex items-center justify-between gap-2">
                Date
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
            <MenuRadioItem value="project" disabled={!compactMode} closeOnClick>
              <span className="flex items-center justify-between gap-2">
                Project
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

export function SidebarHeaderIconButton({
  label,
  tooltip = label,
  className,
  children,
  menuTrigger = false,
  ...rest
}: {
  label: string;
  tooltip?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
  menuTrigger?: boolean;
} & Omit<
  ComponentProps<typeof SidebarMenuButton>,
  "children" | "className" | "tooltip" | "isActive" | "aria-label"
>) {
  const button = (
    <SidebarMenuButton
      size="icon"
      type="button"
      aria-label={label}
      {...rest}
      className={cn("relative size-7 shrink-0", className)}
    />
  );
  return (
    <Tooltip>
      <TooltipTrigger render={menuTrigger ? <MenuTrigger render={button} /> : button}>
        {children}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
