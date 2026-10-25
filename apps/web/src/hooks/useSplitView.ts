import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { toastManager } from "../components/ui/toast";
import { MAX_SPLIT_PANES } from "../splitView.logic";
import { useAllEnvironmentShellsBootstrapped, useQuietThreadShells } from "../state/entities";
import { useSplitViewStore } from "../splitViewStore";
import { buildThreadRouteParams } from "../threadRoutes";
import { useStableCallback } from "./useStableCallback";

export function useSplitViewActions() {
  const navigate = useNavigate();

  const focusThread = useStableCallback((ref: ScopedThreadRef) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(ref),
      replace: true,
    });
  });

  const openInSplitView = useStableCallback((refs: ReadonlyArray<ScopedThreadRef>) => {
    const { open } = useSplitViewStore.getState();
    let focusTarget: ScopedThreadRef | null = null;
    let full = false;
    for (const ref of refs) {
      const { status } = open(scopedThreadKey(ref));
      if (status === "full") full = true;
      else focusTarget = ref;
    }
    if (full) {
      toastManager.add({
        type: "info",
        title: `Split view holds up to ${MAX_SPLIT_PANES} chats`,
        description: "Close a pane to open another.",
      });
    }
    if (focusTarget) focusThread(focusTarget);
  });

  const closePane = useStableCallback((ref: ScopedThreadRef) => {
    const key = scopedThreadKey(ref);
    const closedFocused = useSplitViewStore.getState().focusKey === key;
    const { nextFocusKey } = useSplitViewStore.getState().close(key);
    const next = nextFocusKey === null ? null : parseScopedThreadKey(nextFocusKey);
    if (closedFocused && next) focusThread(next);
  });

  return { closePane, focusThread, openInSplitView };
}

/** Drops persisted panes whose thread was deleted or archived while the app was closed. */
export function usePruneUnavailableSplitPanes() {
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const shells = useQuietThreadShells();
  useEffect(() => {
    if (!bootstrapped) return;
    const available = new Set(
      shells.flatMap((shell) =>
        shell.deletedAt == null && shell.archivedAt == null
          ? [scopedThreadKey({ environmentId: shell.environmentId, threadId: shell.id })]
          : [],
      ),
    );
    const { focusKey } = useSplitViewStore.getState();
    useSplitViewStore.getState().prune((key) => key === focusKey || available.has(key));
  }, [bootstrapped, shells]);
}
