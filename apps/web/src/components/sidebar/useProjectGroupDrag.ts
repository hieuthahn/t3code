import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { projectGroupDropIndex } from "./sidebarProjectArrangement";

const DRAG_THRESHOLD_PX = 4;

export interface ProjectGroupDrag {
  readonly id: string;
  readonly lineTop: number;
}

/** Measure where the dragged group would land among the other group headers in the list. */
function measureDrop(list: HTMLElement, id: string, pointerY: number) {
  const headers = [...list.querySelectorAll<HTMLElement>("[data-project-group]")].filter(
    (header) => header.dataset.projectGroup !== id,
  );
  const rowOf = (header: HTMLElement) => header.closest("li") ?? header;
  const toIndex = projectGroupDropIndex(
    headers.map((header) => {
      const rect = header.getBoundingClientRect();
      return rect.top + rect.height / 2;
    }),
    pointerY,
  );
  const listTop = list.getBoundingClientRect().top;
  const before = headers[toIndex];
  if (before !== undefined) {
    return { toIndex, lineTop: rowOf(before).getBoundingClientRect().top - listTop };
  }
  let last: Element | null = headers.length === 0 ? null : rowOf(headers[headers.length - 1]!);
  while (last?.nextElementSibling?.hasAttribute("data-thread-item")) {
    last = last.nextElementSibling;
  }
  return { toIndex, lineTop: (last?.getBoundingClientRect().bottom ?? listTop) - listTop };
}

/** Drag a project group header by its handle and report the display index it was dropped at. */
export function useProjectGroupDrag(onDrop: (id: string, toIndex: number) => void) {
  const [drag, setDrag] = useState<ProjectGroupDrag | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const handleDrop = useStableCallback(onDrop);
  useEffect(() => () => stopRef.current?.(), []);

  const start = (id: string, event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const list = event.currentTarget.closest("ul");
    if (list === null) return;
    event.preventDefault();
    stopRef.current?.();
    const originY = event.clientY;
    const pointerId = event.pointerId;
    let toIndex: number | null = null;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (toIndex === null && Math.abs(moveEvent.clientY - originY) <= DRAG_THRESHOLD_PX) return;
      moveEvent.preventDefault();
      const drop = measureDrop(list, id, moveEvent.clientY);
      toIndex = drop.toIndex;
      setDrag({ id, lineTop: drop.lineTop });
    };
    const end = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      const dropIndex = toIndex;
      stop();
      if (dropIndex !== null) handleDrop(id, dropIndex);
    };
    const keydown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      stop();
    };
    const stop = () => {
      document.removeEventListener("pointermove", move, { capture: true });
      document.removeEventListener("pointerup", end, { capture: true });
      document.removeEventListener("pointercancel", stop, { capture: true });
      document.removeEventListener("keydown", keydown, { capture: true });
      window.removeEventListener("blur", stop);
      stopRef.current = null;
      setDrag(null);
    };
    document.addEventListener("pointermove", move, { capture: true, passive: false });
    document.addEventListener("pointerup", end, { capture: true });
    document.addEventListener("pointercancel", stop, { capture: true });
    document.addEventListener("keydown", keydown, { capture: true });
    window.addEventListener("blur", stop);
    stopRef.current = stop;
  };

  return { drag, start };
}
