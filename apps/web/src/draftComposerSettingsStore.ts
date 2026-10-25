import type { TeamSetup, TokenSaverConfig } from "@t3tools/contracts";
import { create } from "zustand";

/**
 * Token Saver and team chosen on a draft, carried into the thread its first send creates.
 * Absent follows the server's new-thread defaults; a null team keeps a single agent, and
 * "auto" lets the effort judge choose from the first message.
 */
export interface DraftComposerSettings {
  readonly tokenSaver?: TokenSaverConfig;
  readonly team?: TeamSetup | null | "auto" | undefined;
}

interface DraftComposerSettingsState {
  readonly byThreadKey: Readonly<Record<string, DraftComposerSettings>>;
}

const EMPTY_SETTINGS: DraftComposerSettings = {};

const useDraftComposerSettingsStore = create<DraftComposerSettingsState>(() => ({
  byThreadKey: {},
}));

export function useDraftComposerSettings(threadKey: string | null): DraftComposerSettings {
  return useDraftComposerSettingsStore((state) =>
    threadKey === null ? EMPTY_SETTINGS : (state.byThreadKey[threadKey] ?? EMPTY_SETTINGS),
  );
}

export function readDraftComposerSettings(threadKey: string): DraftComposerSettings {
  return useDraftComposerSettingsStore.getState().byThreadKey[threadKey] ?? EMPTY_SETTINGS;
}

export function updateDraftComposerSettings(
  threadKey: string,
  change: DraftComposerSettings,
): void {
  useDraftComposerSettingsStore.setState((state) => ({
    byThreadKey: {
      ...state.byThreadKey,
      [threadKey]: { ...state.byThreadKey[threadKey], ...change },
    },
  }));
}

export function clearDraftComposerSettings(threadKey: string): void {
  useDraftComposerSettingsStore.setState((state) => {
    if (!(threadKey in state.byThreadKey)) return state;
    const { [threadKey]: _cleared, ...rest } = state.byThreadKey;
    return { byThreadKey: rest };
  });
}
