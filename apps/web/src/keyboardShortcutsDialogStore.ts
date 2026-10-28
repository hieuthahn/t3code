import { create } from "zustand";

interface KeyboardShortcutsDialogState {
  readonly open: boolean;
  readonly requested: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly toggle: () => void;
}

export const useKeyboardShortcutsDialogStore = create<KeyboardShortcutsDialogState>()((set) => ({
  open: false,
  requested: false,
  setOpen: (open) => set((state) => ({ open, requested: state.requested || open })),
  toggle: () => set((state) => ({ open: !state.open, requested: true })),
}));
