import {
  DEFAULT_RESOLVED_KEYBINDINGS,
  compileResolvedKeybindingsConfig,
} from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import { buildShortcutSections, shortcutCaps } from "./KeyboardShortcutsDialog.logic";

function rowFor(
  sections: ReturnType<typeof buildShortcutSections>,
  command: string,
): ReturnType<typeof buildShortcutSections>[number]["rows"][number] | undefined {
  return sections.flatMap((section) => section.rows).find((row) => row.command === command);
}

describe("shortcutCaps", () => {
  it("spells modifiers as symbols on macOS", () => {
    expect(shortcutCaps("mod+shift+k", true)).toEqual(["⇧", "⌘", "K"]);
    expect(shortcutCaps("mod+alt+b", true)).toEqual(["⌥", "⌘", "B"]);
  });

  it("spells modifiers as words elsewhere", () => {
    expect(shortcutCaps("mod+shift+k", false)).toEqual(["Ctrl", "Shift", "K"]);
    expect(shortcutCaps("mod+alt+b", false)).toEqual(["Ctrl", "Alt", "B"]);
  });

  it("keeps a literal plus key", () => {
    expect(shortcutCaps("mod++", false)).toEqual(["Ctrl", "+"]);
  });

  it("names special keys", () => {
    expect(shortcutCaps("esc", true)).toEqual(["Esc"]);
    expect(shortcutCaps("alt+arrowup", false)).toEqual(["Alt", "Up"]);
  });
});

describe("buildShortcutSections", () => {
  const sections = buildShortcutSections(DEFAULT_RESOLVED_KEYBINDINGS, true);

  it("lists the shortcuts dialog itself with its default chord", () => {
    expect(rowFor(sections, "shortcuts.toggle")).toMatchObject({
      label: "Show Keyboard Shortcuts",
      chords: [["⌘", "/"]],
    });
  });

  it("shows rewind as a double Escape", () => {
    expect(rowFor(sections, "thread.rewind")?.chords).toEqual([["Esc", "Esc"]]);
  });

  it("merges every chord of a command into one row", () => {
    expect(rowFor(sections, "chat.new")?.chords).toEqual([
      ["⌘", "N"],
      ["⇧", "⌘", "O"],
    ]);
  });

  it("leaves out numbered jump and usage page shortcuts", () => {
    const commands = sections.flatMap((section) => section.rows.map((row) => row.command));
    expect(commands.some((command) => command.startsWith("thread.jump."))).toBe(false);
    expect(commands.some((command) => command.startsWith("modelPicker.jump."))).toBe(false);
    expect(commands.some((command) => command.startsWith("usage.period."))).toBe(false);
    expect(commands).toContain("usage.open");
  });

  it("reads custom bindings from the keybinding config it is given", () => {
    const custom = compileResolvedKeybindingsConfig([
      { key: "mod+shift+y", command: "sidebar.toggle" },
    ]);
    const customSections = buildShortcutSections(custom, false);
    expect(customSections.flatMap((section) => section.rows)).toHaveLength(1);
    expect(rowFor(customSections, "sidebar.toggle")?.chords).toEqual([["Ctrl", "Shift", "Y"]]);
  });

  it("skips empty sections", () => {
    expect(buildShortcutSections([], true)).toEqual([]);
  });

  it("omits project script commands", () => {
    const withScript = compileResolvedKeybindingsConfig([
      { key: "mod+shift+y", command: "script.test.run" },
    ]);
    expect(buildShortcutSections(withScript, true)).toEqual([]);
  });
});
