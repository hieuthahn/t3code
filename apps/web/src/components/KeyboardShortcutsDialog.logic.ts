import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { parseKeybindingShortcut } from "@t3tools/shared/keybindings";

import { formatShortcutKeyLabel } from "../keybindings";
import {
  buildKeybindingRows,
  commandLabel,
  groupKeybindingRows,
  type KeybindingRow,
} from "./settings/KeybindingsSettings.logic";

const CONTEXTUAL_WHEN_VARIABLE = /\b(usagePageOpen|modelPickerOpen)\b/;
const ESCAPE_CHORD_WHEN_VARIABLE = /\bescapeChord\b/;

export interface ShortcutRowView {
  readonly command: KeybindingCommand;
  readonly label: string;
  readonly chords: ReadonlyArray<ReadonlyArray<string>>;
}

export interface ShortcutSection {
  readonly id: string;
  readonly title: string;
  readonly rows: ReadonlyArray<ShortcutRowView>;
}

export function shortcutCaps(key: string, isMac: boolean): ReadonlyArray<string> {
  const shortcut = parseKeybindingShortcut(key);
  if (shortcut === null) return [key];
  const meta = shortcut.metaKey || (shortcut.modKey && isMac);
  const ctrl = shortcut.ctrlKey || (shortcut.modKey && !isMac);
  const modifiers = isMac
    ? [ctrl && "⌃", shortcut.altKey && "⌥", shortcut.shiftKey && "⇧", meta && "⌘"]
    : [ctrl && "Ctrl", shortcut.altKey && "Alt", shortcut.shiftKey && "Shift", meta && "Meta"];
  return [...modifiers.filter((cap) => cap !== false), formatShortcutKeyLabel(shortcut.key)];
}

function rowCaps(row: KeybindingRow, isMac: boolean): ReadonlyArray<string> {
  const caps = shortcutCaps(row.key, isMac);
  return ESCAPE_CHORD_WHEN_VARIABLE.test(row.when) ? [...caps, ...caps] : caps;
}

/** Groups the live keybinding config into dialog sections, one row per command. */
export function buildShortcutSections(
  keybindings: ResolvedKeybindingsConfig,
  isMac: boolean,
): ReadonlyArray<ShortcutSection> {
  const rows = buildKeybindingRows(keybindings).filter(
    (row) => !row.command.startsWith("script.") && !CONTEXTUAL_WHEN_VARIABLE.test(row.when),
  );
  return groupKeybindingRows(rows).map((group) => {
    const chordsByCommand = new Map<KeybindingCommand, Array<ReadonlyArray<string>>>();
    for (const row of group.rows) {
      const chords = chordsByCommand.get(row.command) ?? [];
      const caps = rowCaps(row, isMac);
      if (!chords.some((chord) => chord.join("\u0000") === caps.join("\u0000"))) chords.push(caps);
      chordsByCommand.set(row.command, chords);
    }
    return {
      id: group.id,
      title: group.title,
      rows: [...chordsByCommand].map(([command, chords]) => ({
        command,
        label: commandLabel(command),
        chords,
      })),
    };
  });
}
