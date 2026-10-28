import { describe, expect, it } from "vite-plus/test";

import {
  createEscapeChordDetector,
  isEscapeChordBlockedByOverlay,
  type EscapeChordEvent,
} from "./escapeChord.logic";

function key(overrides: Partial<EscapeChordEvent> = {}): EscapeChordEvent {
  return {
    key: "Escape",
    repeat: false,
    isComposing: false,
    keyCode: 27,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

function setup() {
  let now = 1_000;
  const detector = createEscapeChordDetector({ now: () => now });
  return {
    detector,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("escape chord detector", () => {
  it("fires on the second Escape inside the window", () => {
    const { detector, advance } = setup();
    expect(detector.observe(key(), false)).toBe(false);
    advance(300);
    expect(detector.observe(key(), false)).toBe(true);
  });

  it("keeps a single Escape inert", () => {
    const { detector } = setup();
    expect(detector.observe(key(), false)).toBe(false);
  });

  it("does not fire when the second Escape arrives after the window", () => {
    const { detector, advance } = setup();
    detector.observe(key(), false);
    advance(451);
    expect(detector.observe(key(), false)).toBe(false);
  });

  it("treats the late second Escape as a new first press", () => {
    const { detector, advance } = setup();
    detector.observe(key(), false);
    advance(900);
    detector.observe(key(), false);
    advance(200);
    expect(detector.observe(key(), false)).toBe(true);
  });

  it("fires at the window edge", () => {
    const { detector, advance } = setup();
    detector.observe(key(), false);
    advance(450);
    expect(detector.observe(key(), false)).toBe(true);
  });

  it("resets after firing so a third press does not fire", () => {
    const { detector, advance } = setup();
    detector.observe(key(), false);
    advance(100);
    expect(detector.observe(key(), false)).toBe(true);
    advance(100);
    expect(detector.observe(key(), false)).toBe(false);
    advance(100);
    expect(detector.observe(key(), false)).toBe(true);
  });

  it("ignores key repeat from a held Escape", () => {
    const { detector, advance } = setup();
    detector.observe(key(), false);
    advance(100);
    expect(detector.observe(key({ repeat: true }), false)).toBe(false);
    advance(100);
    expect(detector.observe(key({ repeat: true }), false)).toBe(false);
  });

  it.each([
    ["isComposing", { isComposing: true }],
    ["keyCode 229", { keyCode: 229 }],
  ])("resets and ignores a press with %s", (_label, overrides) => {
    const { detector, advance } = setup();
    detector.observe(key(), false);
    advance(100);
    expect(detector.observe(key(overrides), false)).toBe(false);
    advance(100);
    expect(detector.observe(key(), false)).toBe(false);
  });

  it("does not arm from a composing first press", () => {
    const { detector, advance } = setup();
    detector.observe(key({ isComposing: true }), false);
    advance(100);
    expect(detector.observe(key(), false)).toBe(false);
  });

  it("resets and ignores a blocked press", () => {
    const { detector, advance } = setup();
    detector.observe(key(), false);
    advance(100);
    expect(detector.observe(key(), true)).toBe(false);
    advance(100);
    expect(detector.observe(key(), false)).toBe(false);
  });

  it("fires on the third press after a blocked first press", () => {
    const { detector, advance } = setup();
    detector.observe(key(), true);
    advance(100);
    expect(detector.observe(key(), false)).toBe(false);
    advance(100);
    expect(detector.observe(key(), false)).toBe(true);
  });

  it("resets when another key lands between the presses", () => {
    const { detector, advance } = setup();
    detector.observe(key(), false);
    advance(100);
    detector.observe(key({ key: "a", keyCode: 65 }), false);
    advance(100);
    expect(detector.observe(key(), false)).toBe(false);
  });

  it("lets a bare modifier key sit between the presses", () => {
    const { detector, advance } = setup();
    detector.observe(key(), false);
    advance(100);
    detector.observe(key({ key: "Shift", keyCode: 16, shiftKey: true }), false);
    advance(100);
    expect(detector.observe(key(), false)).toBe(true);
  });

  it.each([
    ["shift", { shiftKey: true }],
    ["ctrl", { ctrlKey: true }],
    ["alt", { altKey: true }],
    ["meta", { metaKey: true }],
  ])("ignores Escape held with %s", (_label, overrides) => {
    const { detector, advance } = setup();
    detector.observe(key(), false);
    advance(100);
    expect(detector.observe(key(overrides), false)).toBe(false);
    advance(100);
    expect(detector.observe(key(), false)).toBe(false);
  });
});

describe("isEscapeChordBlockedByOverlay", () => {
  it("is blocked when the root finds an open overlay", () => {
    expect(isEscapeChordBlockedByOverlay({ querySelector: () => ({}) })).toBe(true);
  });

  it("is clear when the root finds none", () => {
    expect(isEscapeChordBlockedByOverlay({ querySelector: () => null })).toBe(false);
  });

  it("queries dialogs, popovers, menus, and the composer autocomplete", () => {
    let selector = "";
    isEscapeChordBlockedByOverlay({
      querySelector: (value) => {
        selector = value;
        return null;
      },
    });
    for (const expected of [
      "dialog-popup",
      "alert-dialog-popup",
      "popover-popup",
      "menu-popup",
      "data-composer-command-drawer",
    ]) {
      expect(selector).toContain(expected);
    }
  });

  it("ignores closed keepMounted popups, so a dismissed popover stops blocking", () => {
    let selector = "";
    isEscapeChordBlockedByOverlay({
      querySelector: (value) => {
        selector = value;
        return null;
      },
    });
    const popupClauses = selector.split(", ").filter((clause) => clause.includes("-popup"));
    expect(popupClauses.length).toBeGreaterThan(0);
    for (const clause of popupClauses) {
      expect(clause).toContain(":is([data-open],[data-ending-style])");
    }
  });
});
