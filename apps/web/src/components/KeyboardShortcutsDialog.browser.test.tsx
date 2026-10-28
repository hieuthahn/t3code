import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";

vi.mock(import("@effect/atom-react"), async (original) => {
  const { DEFAULT_RESOLVED_KEYBINDINGS: defaults } = await import("@t3tools/shared/keybindings");
  return { ...(await original()), useAtomValue: (() => defaults) as never };
});
vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { DEFAULT_RESOLVED_KEYBINDINGS: defaults } = await import("@t3tools/shared/keybindings");
  return { ...actual, primaryServerKeybindingsAtom: Atom.make(defaults) };
});

import { registerKeyboardShortcutsCommand } from "./AppSidebarLayout";
import { KeyboardShortcutsDialogHost } from "./KeyboardShortcutsDialog";
import { useKeyboardShortcutsDialogStore } from "../keyboardShortcutsDialogStore";

function setup(platform: string) {
  useKeyboardShortcutsDialogStore.setState({ open: false });
  const stack = new DisposableStack();
  stack.use(vi.spyOn(navigator, "platform", "get").mockReturnValue(platform));
  stack.defer(registerKeyboardShortcutsCommand());
  stack.defer(() => useKeyboardShortcutsDialogStore.setState({ open: false }));
  return stack;
}

describe("keyboard shortcuts dialog", () => {
  it("opens on Ctrl+/ and lists shortcuts from the keybinding config", async () => {
    using _setup = setup("Linux x86_64");
    await using _screen = await render(<KeyboardShortcutsDialogHost />, { router: false });

    await userEvent.keyboard("{Control>}/{/Control}");

    await expect.element(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
    await expect.element(page.getByText("Show Keyboard Shortcuts")).toBeVisible();
    await expect.element(page.getByText("Thread: Rewind")).toBeVisible();
  });

  it("toggles closed on a second press", async () => {
    using _setup = setup("Linux x86_64");
    await using _screen = await render(<KeyboardShortcutsDialogHost />, { router: false });

    await userEvent.keyboard("{Control>}/{/Control}");
    expect(useKeyboardShortcutsDialogStore.getState().open).toBe(true);
    await userEvent.keyboard("{Control>}/{/Control}");

    expect(useKeyboardShortcutsDialogStore.getState().open).toBe(false);
  });

  it("opens on Cmd+/ on macOS", async () => {
    using _setup = setup("MacIntel");
    await using _screen = await render(<KeyboardShortcutsDialogHost />, { router: false });

    await userEvent.keyboard("{Meta>}/{/Meta}");

    expect(useKeyboardShortcutsDialogStore.getState().open).toBe(true);
  });

  it("ignores a bare slash", async () => {
    using _setup = setup("Linux x86_64");
    await using _screen = await render(<KeyboardShortcutsDialogHost />, { router: false });

    await userEvent.keyboard("/");

    expect(useKeyboardShortcutsDialogStore.getState().open).toBe(false);
  });
});
