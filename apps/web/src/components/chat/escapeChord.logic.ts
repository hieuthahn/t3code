export const ESCAPE_CHORD_WINDOW_MS = 450;

const OVERLAY_SLOTS = [
  "dialog",
  "alert-dialog",
  "command-dialog",
  "sheet",
  "popover",
  "menu",
  "select",
  "combobox",
  "autocomplete",
] as const;

const OVERLAY_SELECTOR = [
  ...OVERLAY_SLOTS.map((slot) => `[data-slot="${slot}-popup"]:is([data-open],[data-ending-style])`),
  '[data-composer-command-drawer="true"]',
].join(", ");

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

export interface EscapeChordEvent {
  readonly key: string;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  readonly keyCode: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export function isEscapeChordBlockedByOverlay(root: {
  readonly querySelector: (selector: string) => unknown;
}): boolean {
  return root.querySelector(OVERLAY_SELECTOR) !== null;
}

/** Observe every keydown; returns true on the second clean Escape inside the window. */
export function createEscapeChordDetector(
  options: { readonly windowMs?: number; readonly now?: () => number } = {},
) {
  const windowMs = options.windowMs ?? ESCAPE_CHORD_WINDOW_MS;
  const now = options.now ?? Date.now;
  let lastEscapeAt: number | null = null;
  return {
    observe(event: EscapeChordEvent, blocked: boolean): boolean {
      if (event.key !== "Escape") {
        if (!MODIFIER_KEYS.has(event.key)) lastEscapeAt = null;
        return false;
      }
      if (event.repeat) return false;
      if (
        blocked ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        lastEscapeAt = null;
        return false;
      }
      const at = now();
      const fired = lastEscapeAt !== null && at - lastEscapeAt <= windowMs;
      lastEscapeAt = fired ? null : at;
      return fired;
    },
  };
}
