import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { Columns2Icon, XIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { useSplitViewActions } from "../hooks/useSplitView";
import { useStableCallback } from "../hooks/useStableCallback";
import { observeResize } from "../lib/observeResize";
import { cn } from "../lib/utils";
import {
  followRouteThread,
  resolveVisiblePaneCount,
  visiblePanes,
  MAX_SPLIT_PANES,
} from "../splitView.logic";
import { useSplitViewStore } from "../splitViewStore";
import type { ThreadRouteTarget } from "../threadRoutes";
import {
  threadContextDropTargetProps,
  useThreadContextDrop,
  useThreadContextDragGhost,
} from "./chat/threadContextDrag";
import { SplitPaneFocusContext } from "./chat/splitPaneFocusContext";
import { ThreadRouteView } from "./ThreadRouteView";
import { Button } from "./ui/button";
import { SidebarInset } from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const SPLIT_PANE_MIN_WIDTH = 400;
const FOLLOW_GUTTER_STYLE = {
  "--workspace-titlebar-content-left": "var(--workspace-gutter-start)",
} as CSSProperties;
const SPLIT_PANE_CLASS =
  "[contain:layout] [--workspace-controls-right:calc(env(safe-area-inset-right)+3rem)]";
const SPLIT_TRAILING_PANE_CLASS =
  "[.wco_&]:[--workspace-controls-right:calc(100vw-env(titlebar-area-width,100vw)-env(titlebar-area-x,0px)+3rem)]";

function useElementWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    return observeResize(element, (entries) => {
      const entry = entries.at(-1);
      if (entry) setWidth(entry.contentRect.width);
    });
  }, [ref]);
  return width;
}

function SplitDropHint() {
  const dragging = useThreadContextDragGhost() !== null;
  if (!dragging) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-2 z-30 flex items-start justify-center rounded-xl border-2 border-dashed border-primary/40 pt-24 transition-colors group-data-[thread-context-over=true]/split:border-primary group-data-[thread-context-over=true]/split:bg-primary/8"
    >
      <span className="inline-flex items-center gap-2 rounded-full bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm ring-1 ring-border">
        <Columns2Icon aria-hidden className="size-4" />
        Split view
      </span>
    </div>
  );
}

function SplitPane(props: {
  threadRef: ScopedThreadRef;
  focused: boolean;
  leading: boolean;
  trailing: boolean;
  isSplit: boolean;
  onFocus: (ref: ScopedThreadRef) => void;
  onClose: (ref: ScopedThreadRef) => void;
}) {
  const { threadRef, focused, isSplit } = props;
  const target = { kind: "server" as const, threadRef };
  const focus = useStableCallback(() => {
    if (!focused) props.onFocus(threadRef);
  });
  const close = useStableCallback(() => props.onClose(threadRef));
  return (
    <div
      data-split-pane={scopedThreadKey(threadRef)}
      data-focused={focused ? "true" : "false"}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col",
        !props.leading && "border-l border-border",
        isSplit && SPLIT_PANE_CLASS,
        isSplit && props.trailing && SPLIT_TRAILING_PANE_CLASS,
      )}
      style={props.leading ? undefined : FOLLOW_GUTTER_STYLE}
      onPointerDownCapture={focus}
      onFocusCapture={focus}
    >
      {isSplit && focused ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 bg-primary/70"
        />
      ) : null}
      {isSplit ? (
        <div className="absolute top-[var(--workspace-controls-top)] right-3 z-50 flex h-[var(--workspace-topbar-height)] items-center [-webkit-app-region:no-drag]">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button aria-label="Close pane" variant="ghost" size="icon-sm" onClick={close} />
              }
            >
              <XIcon aria-hidden className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Close pane</TooltipPopup>
          </Tooltip>
        </div>
      ) : null}
      <SplitPaneFocusContext value={focused}>
        <ThreadRouteView
          target={target}
          reserveTitleBarControlInset={props.trailing}
          {...(isSplit ? { onMissing: close } : {})}
        />
      </SplitPaneFocusContext>
    </div>
  );
}

function ServerThreadSplitView({ threadRef }: { threadRef: ScopedThreadRef }) {
  const routeKey = scopedThreadKey(threadRef);
  const storedPanes = useSplitViewStore((state) => state.panes);
  const focusKey = useSplitViewStore((state) => state.focusKey);
  const panes = followRouteThread(storedPanes, focusKey, routeKey);
  const { closePane, focusThread, openInSplitView } = useSplitViewActions();
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);

  useLayoutEffect(() => {
    useSplitViewStore.getState().followRoute(routeKey);
  }, [routeKey]);
  useLayoutEffect(() => () => useSplitViewStore.getState().followRoute(null), []);

  useThreadContextDrop(
    containerRef,
    threadRef.environmentId as EnvironmentId,
    "split-view",
    (refs) => openInSplitView(refs),
  );

  const visibleCount = resolveVisiblePaneCount({
    availableWidth: width === 0 ? Number.POSITIVE_INFINITY : width,
    minPaneWidth: SPLIT_PANE_MIN_WIDTH,
    paneCount: panes.length,
  });
  const shown = visiblePanes(panes, routeKey, visibleCount);
  const shownRefs = shown.flatMap((key) => {
    const ref = parseScopedThreadKey(key);
    return ref ? [ref] : [];
  });
  const isSplit = panes.length > 1;

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh">
      <div
        ref={containerRef}
        {...threadContextDropTargetProps()}
        className="group/split relative flex min-h-0 min-w-0 flex-1"
        data-split-view={isSplit ? "true" : "false"}
      >
        {shownRefs.map((ref, index) => (
          <SplitPane
            key={scopedThreadKey(ref)}
            threadRef={ref}
            focused={scopedThreadKey(ref) === routeKey}
            leading={index === 0}
            trailing={index === shownRefs.length - 1}
            isSplit={isSplit}
            onFocus={focusThread}
            onClose={closePane}
          />
        ))}
        {panes.length < MAX_SPLIT_PANES || isSplit ? <SplitDropHint /> : null}
      </div>
    </SidebarInset>
  );
}

export function ThreadSplitView({ target }: { target: ThreadRouteTarget }) {
  if (target.kind === "draft") {
    return (
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh">
        <ThreadRouteView target={target} />
      </SidebarInset>
    );
  }
  return <ServerThreadSplitView threadRef={target.threadRef} />;
}
