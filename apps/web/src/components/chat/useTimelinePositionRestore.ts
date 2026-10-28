import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import type { AssistantCitationRequest } from "./AssistantCitationSource";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";
import type { RememberedTimelinePosition } from "./timelineScrollAnchoring";

// A streaming reply moves the end every frame, so the target may never hold
// still. Past this many frames the list's own end maintenance takes over.
const SETTLE_MAX_FRAMES = 60;

/**
 * Index and end scrolling start from estimated row sizes, so they can stop
 * short of a tall row. Corrects against the DOM until the viewport holds the
 * target for two layout frames, the frame budget runs out, the caller cancels,
 * or the target disappears.
 */
export function settleListScroll(
  list: Pick<LegendListRef, "getScrollableNode" | "scrollToOffset">,
  target: (element: HTMLElement) => number | undefined,
  isCancelled: () => boolean,
): Promise<void> {
  return new Promise((resolve) => {
    let stableFrames = 0;
    let frames = 0;
    const reconcile = () => {
      if (isCancelled()) return resolve();
      const element = list.getScrollableNode();
      const offset = element ? target(element) : undefined;
      frames += 1;
      if (!element || offset === undefined || frames > SETTLE_MAX_FRAMES) return resolve();
      if (Math.abs(element.scrollTop - offset) > 1) {
        stableFrames = 0;
        void list.scrollToOffset({ offset, animated: false }).then(() => {
          requestAnimationFrame(reconcile);
        });
        return;
      }
      stableFrames += 1;
      if (stableFrames >= 2) resolve();
      else requestAnimationFrame(reconcile);
    };
    requestAnimationFrame(reconcile);
  });
}

export const measuredEndOffset = (element: HTMLElement) =>
  element.scrollHeight - element.clientHeight;

/**
 * Scrolls a newly shown thread back to where the user left it, or to its end,
 * and reports the thread positioned once the saved row settles.
 */
export function useTimelinePositionRestore({
  listRef,
  listIdentityKey,
  restoringThreadPosition,
  rememberedPosition,
  rows,
  citationRequest,
  cancelPositionRestoreRef,
  earlierHistory,
  onManualNavigation,
  onPositioned,
}: {
  readonly listRef: React.RefObject<LegendListRef | null>;
  readonly listIdentityKey: string;
  readonly restoringThreadPosition: boolean;
  readonly rememberedPosition: RememberedTimelinePosition | undefined;
  readonly rows: MessagesTimelineRow[];
  readonly citationRequest: AssistantCitationRequest | null;
  readonly cancelPositionRestoreRef: React.RefObject<(() => void) | null> | undefined;
  readonly earlierHistory:
    | {
        readonly available: boolean;
        readonly loading: boolean;
        readonly load: (throughEntryId: string) => void;
      }
    | undefined;
  readonly onManualNavigation: () => void;
  readonly onPositioned: (identity: string) => void;
}) {
  // Preserve initialScrollAtEnd's measured target until the list is reused
  // for another thread; scrollToEnd would replace it with an estimated offset.
  const listOpenedOnRef = useRef<{
    readonly list: LegendListRef;
    identity: string | null;
  } | null>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    const opened = listOpenedOnRef.current;
    if (!list) return;
    if (opened?.list !== list) {
      listOpenedOnRef.current = { list, identity: listIdentityKey };
    } else if (opened.identity !== listIdentityKey) {
      opened.identity = null;
    }
  });
  const savedRowMissing =
    restoringThreadPosition &&
    rememberedPosition?.atEnd === false &&
    !rows.some((row) => row.id === rememberedPosition.rowId);
  const historyEntryId = savedRowMissing ? rememberedPosition?.historyEntryId : undefined;
  const historyPage = `${listIdentityKey}:${rows[0]?.id}`;
  const [stalledHistoryPage, setStalledHistoryPage] = useState<string | null>(null);
  if (!restoringThreadPosition && stalledHistoryPage !== null) setStalledHistoryPage(null);
  const awaitingHistory =
    historyEntryId !== undefined &&
    earlierHistory?.available === true &&
    stalledHistoryPage !== historyPage &&
    !rows.some((row) => row.id === historyEntryId);
  const loadEarlierHistory = useEffectEvent((throughEntryId: string) =>
    earlierHistory?.load(throughEntryId),
  );
  const historyRequestRef = useRef<{ readonly page: string; sawLoading: boolean } | null>(null);
  const historyLoading = earlierHistory?.loading === true;
  useEffect(() => {
    if (!awaitingHistory || historyEntryId === undefined) {
      historyRequestRef.current = null;
      return;
    }
    const request = historyRequestRef.current;
    if (request?.page === historyPage) {
      if (historyLoading) request.sawLoading = true;
      else if (request.sawLoading) setStalledHistoryPage(historyPage);
      return;
    }
    if (historyLoading) return;
    historyRequestRef.current = { page: historyPage, sawLoading: false };
    loadEarlierHistory(historyEntryId);
  }, [awaitingHistory, historyEntryId, historyLoading, historyPage]);
  useLayoutEffect(() => {
    if (!restoringThreadPosition || rows.length === 0) return;
    const list = listRef.current;
    if (!list) return;
    if (citationRequest !== null) {
      // The citation scroll owns positioning once the list has mounted.
      onPositioned(listIdentityKey);
      return;
    }
    let cancelled = false;
    const viewport: HTMLElement | null = list.getScrollableNode();
    const cancelRestoration = () => {
      if (cancelled) return;
      cancelled = true;
      if (viewport) void list.scrollToOffset({ offset: viewport.scrollTop, animated: false });
      onPositioned(listIdentityKey);
    };
    const cancelForNavigation = () => {
      cancelRestoration();
      onManualNavigation();
    };
    const onScrollKey = (event: globalThis.KeyboardEvent) => {
      if (
        ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key) &&
        !(
          event.target instanceof Element &&
          event.target.closest("input, textarea, [contenteditable=true]")
        )
      )
        cancelForNavigation();
    };
    viewport?.addEventListener("wheel", cancelForNavigation, { passive: true });
    viewport?.addEventListener("touchmove", cancelForNavigation, { passive: true });
    viewport?.addEventListener("pointerdown", cancelForNavigation, { passive: true });
    viewport?.ownerDocument.addEventListener("keydown", onScrollKey);
    const position = rememberedPosition;
    const savedIndex = position ? rows.findIndex((row) => row.id === position.rowId) : -1;
    const historyIndex =
      savedIndex < 0 && position?.historyEntryId !== undefined
        ? rows.findIndex((row) => row.id === position.historyEntryId)
        : -1;
    const target =
      position?.atEnd !== false
        ? undefined
        : savedIndex >= 0
          ? { index: savedIndex, rowId: position.rowId, offsetWithinRow: position.offsetWithinRow }
          : historyIndex >= 0
            ? { index: historyIndex, rowId: position.historyEntryId!, offsetWithinRow: 0 }
            : undefined;
    // A saved row outside the loaded history page has no valid offset, so it waits at the end.
    const restoresRow = target !== undefined;
    if (restoresRow || awaitingHistory) onManualNavigation();
    if (cancelPositionRestoreRef) cancelPositionRestoreRef.current = cancelRestoration;
    const scrolling = restoresRow
      ? list.scrollToIndex({
          index: target.index,
          animated: false,
          viewPosition: 0,
          viewOffset: -target.offsetWithinRow,
        })
      : position?.atEnd !== false && listOpenedOnRef.current?.identity === listIdentityKey
        ? undefined
        : list.scrollToEnd({ animated: false });
    const settlesAtEnd = !restoresRow && scrolling !== undefined;
    void Promise.resolve(scrolling).then(async () => {
      if (cancelled) return;
      if (settlesAtEnd) {
        await settleListScroll(list, measuredEndOffset, () => cancelled);
      } else if (restoresRow) {
        // Keep the saved row mounted until its measured position and the DOM agree.
        await settleListScroll(
          list,
          (element) => {
            const state = list.getState();
            const rowIndex = state.indexByKey(target.rowId);
            const row = rowIndex === undefined ? undefined : state.elementAtIndex(rowIndex);
            if (!row) return undefined;
            return Math.max(
              0,
              Math.min(
                element.scrollTop +
                  row.getBoundingClientRect().top -
                  element.getBoundingClientRect().top +
                  target.offsetWithinRow,
                measuredEndOffset(element),
              ),
            );
          },
          () => cancelled,
        );
      }
      if (!cancelled && !awaitingHistory) onPositioned(listIdentityKey);
    });
    return () => {
      cancelled = true;
      if (cancelPositionRestoreRef?.current === cancelRestoration) {
        cancelPositionRestoreRef.current = null;
      }
      viewport?.removeEventListener("wheel", cancelForNavigation);
      viewport?.removeEventListener("touchmove", cancelForNavigation);
      viewport?.removeEventListener("pointerdown", cancelForNavigation);
      viewport?.ownerDocument.removeEventListener("keydown", onScrollKey);
    };
  }, [
    awaitingHistory,
    citationRequest,
    cancelPositionRestoreRef,
    listIdentityKey,
    listRef,
    onManualNavigation,
    onPositioned,
    rememberedPosition,
    restoringThreadPosition,
    rows,
  ]);
}
