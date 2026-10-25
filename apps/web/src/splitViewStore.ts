import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import {
  closePane,
  followRouteThread,
  openPane,
  type OpenPaneResult,
  type PaneChange,
} from "./splitView.logic";

const SPLIT_VIEW_STORAGE_KEY = "t3code:split-view:v1";
const SPLIT_VIEW_STORAGE_VERSION = 1;

interface SplitViewState {
  panes: ReadonlyArray<string>;
  focusKey: string | null;
  open: (key: string) => OpenPaneResult;
  close: (key: string) => PaneChange;
  followRoute: (routeKey: string | null) => void;
}

export const useSplitViewStore = create<SplitViewState>()(
  persist(
    (set, get) => ({
      panes: [],
      focusKey: null,
      open: (key) => {
        const { panes, focusKey } = get();
        const base = focusKey === null ? [] : panes.length > 0 ? panes : [focusKey];
        const result = openPane(base, key);
        set({ panes: result.panes });
        return result;
      },
      close: (key) => {
        const change = closePane(get().panes, key);
        set({ panes: change.panes });
        return change;
      },
      followRoute: (routeKey) => {
        const { panes, focusKey } = get();
        set({
          panes: routeKey === null ? panes : followRouteThread(panes, focusKey, routeKey),
          focusKey: routeKey,
        });
      },
    }),
    {
      name: SPLIT_VIEW_STORAGE_KEY,
      version: SPLIT_VIEW_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ panes: state.panes }),
    },
  ),
);
