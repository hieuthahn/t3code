export const MAX_SPLIT_PANES = 3;

export type OpenPaneResult = {
  readonly panes: ReadonlyArray<string>;
  readonly status: "opened" | "exists" | "full";
};

export function openPane(panes: ReadonlyArray<string>, key: string): OpenPaneResult {
  if (panes.includes(key)) return { panes, status: "exists" };
  if (panes.length >= MAX_SPLIT_PANES) return { panes, status: "full" };
  return { panes: [...panes, key], status: "opened" };
}

export type PaneChange = {
  readonly panes: ReadonlyArray<string>;
  readonly nextFocusKey: string | null;
};

/** The neighbour that slides into the closed pane's slot takes focus, else the one before it. */
export function closePane(panes: ReadonlyArray<string>, key: string): PaneChange {
  const index = panes.indexOf(key);
  if (index === -1) return { panes, nextFocusKey: null };
  const remaining = panes.filter((candidate) => candidate !== key);
  return { panes: remaining, nextFocusKey: remaining[index] ?? remaining[index - 1] ?? null };
}

export function pruneUnavailablePanes(
  panes: ReadonlyArray<string>,
  focusKey: string | null,
  isAvailable: (key: string) => boolean,
): PaneChange {
  const remaining = panes.filter(isAvailable);
  if (remaining.length === panes.length) return { panes, nextFocusKey: focusKey };
  if (focusKey !== null && remaining.includes(focusKey)) {
    return { panes: remaining, nextFocusKey: focusKey };
  }
  const index = focusKey === null ? -1 : panes.indexOf(focusKey);
  const nextFocusKey =
    remaining.find((key) => panes.indexOf(key) > index) ?? remaining.at(-1) ?? null;
  return { panes: remaining, nextFocusKey };
}

/** Navigation to a thread without a pane takes over the focused pane's slot. */
export function followRouteThread(
  panes: ReadonlyArray<string>,
  previousKey: string | null,
  routeKey: string,
): ReadonlyArray<string> {
  if (panes.includes(routeKey)) return panes;
  const index = previousKey === null || panes.length < 2 ? -1 : panes.indexOf(previousKey);
  return index === -1 ? [routeKey] : panes.map((key, slot) => (slot === index ? routeKey : key));
}

export function resolveVisiblePaneCount(input: {
  readonly availableWidth: number;
  readonly minPaneWidth: number;
  readonly paneCount: number;
}): number {
  const fitting = Math.floor(input.availableWidth / input.minPaneWidth);
  return Math.max(1, Math.min(fitting, input.paneCount, MAX_SPLIT_PANES));
}

export function visiblePanes(
  panes: ReadonlyArray<string>,
  focusKey: string | null,
  count: number,
): ReadonlyArray<string> {
  if (panes.length <= count) return panes;
  const focusIndex = focusKey === null ? 0 : Math.max(0, panes.indexOf(focusKey));
  const start = Math.min(Math.max(0, focusIndex - count + 1), panes.length - count);
  return panes.slice(start, start + count);
}
