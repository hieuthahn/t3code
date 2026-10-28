import { create } from "zustand";

interface KeyboardShortcutsDialogState {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly toggle: () => void;
}

export const useKeyboardShortcutsDialogStore = create<KeyboardShortcutsDialogState>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
