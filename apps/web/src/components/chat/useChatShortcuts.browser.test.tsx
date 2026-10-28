import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { useEffect } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import type { ChatComposerHandle } from "./ChatComposer";
import { SplitPaneFocusContext } from "./splitPaneFocusContext";
import { useChatShortcuts, type ChatShortcutCommands } from "./useChatShortcuts";

const shortcutContext = {
  terminalFocus: false,
  terminalOpen: false,
  previewFocus: false,
  previewOpen: false,
  isWeb: true,
  isDesktop: false,
  modelPickerOpen: false,
};

const focusOnMount = (element: HTMLElement | null) => element?.focus();

// Stands in for the right panel's launcher, which needs the whole app around it. Like the
// real one it takes focus, advertises its letters in `data-surface-launcher-keys`, and
// claims one from its own window capture listener unless the key was already handled.
function Launcher(props: { keys: string; received: string[] }) {
  useEffect(() => {
    const claim = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!props.keys.toLowerCase().split("").includes(event.key.toLowerCase())) return;
      event.preventDefault();
      props.received.push(event.key);
    };
    window.addEventListener("keydown", claim, true);
    return () => window.removeEventListener("keydown", claim, true);
  }, [props.keys, props.received]);
  return (
    <div
      ref={focusOnMount}
      tabIndex={0}
      aria-label="Open a surface"
      data-surface-launcher-keys={props.keys}
    />
  );
}

// The chat's shortcut listener registers when the chat mounts, so a launcher that opens
// later registers after it. Tests mount the chat first and add the launcher by rerendering.
function Chat(props: {
  composerKeys: string[];
  launcher?: { keys: string; received: string[] };
  commands?: ChatShortcutCommands;
  threadFindActive?: boolean;
}) {
  useChatShortcuts({
    enabled: true,
    keybindings: props.commands ? DEFAULT_RESOLVED_KEYBINDINGS : [],
    scriptKeybindings: [],
    getShortcutContext: () => shortcutContext,
    threadFindActive: props.threadFindActive ?? false,
    // Type-to-focus only calls insertTextAtEnd, so the stand-in composer implements just that.
    composerRef: {
      current: {
        insertTextAtEnd: (key: string) => {
          props.composerKeys.push(key);
          return true;
        },
      } as Partial<ChatComposerHandle> as ChatComposerHandle,
    },
    branchToolbarRef: { current: null },
    closeThreadFind: () => {},
    commands: props.commands ?? {},
    fallback: () => undefined,
  });
  return props.launcher ? <Launcher {...props.launcher} /> : null;
}

// router: false because the chat shortcuts and the launcher stand-in never navigate.
const options = { router: false } as const;

it("leaves the launcher's letters to the launcher, in either case", async () => {
  const composerKeys: string[] = [];
  const received: string[] = [];
  await using screen = await render(<Chat composerKeys={composerKeys} />, options);
  await screen.rerender(<Chat composerKeys={composerKeys} launcher={{ keys: "BT", received }} />);

  await userEvent.keyboard("tT");

  expect(received).toEqual(["t", "T"]);
  expect(composerKeys).toEqual([]);
});

it("still types other letters into the composer while the launcher is open", async () => {
  const composerKeys: string[] = [];
  const received: string[] = [];
  await using screen = await render(<Chat composerKeys={composerKeys} />, options);
  await screen.rerender(<Chat composerKeys={composerKeys} launcher={{ keys: "BT", received }} />);

  await userEvent.keyboard("a");

  expect(composerKeys).toEqual(["a"]);
  expect(received).toEqual([]);
});

function Pane(props: { focused: boolean; composerKeys: string[] }) {
  return (
    <SplitPaneFocusContext value={props.focused}>
      <Chat composerKeys={props.composerKeys} />
    </SplitPaneFocusContext>
  );
}

it("sends type-to-focus to the focused pane when two panes are mounted", async () => {
  const first: string[] = [];
  const second: string[] = [];
  await using _screen = await render(
    <>
      <Pane focused={false} composerKeys={first} />
      <Pane focused composerKeys={second} />
    </>,
    options,
  );

  await userEvent.keyboard("a");

  expect(first).toEqual([]);
  expect(second).toEqual(["a"]);
});

function pressEscape(init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.body.dispatchEvent(event);
  return event;
}

function escapeChordSetup() {
  let now = 10_000;
  const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
  const rewind = vi.fn();
  return {
    [Symbol.dispose]: () => spy.mockRestore(),
    rewind,
    commands: { "thread.rewind": rewind } satisfies ChatShortcutCommands,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

it("opens rewind on a quick second Escape and leaves the first one alone", async () => {
  using setup = escapeChordSetup();
  await using _screen = await render(<Chat composerKeys={[]} commands={setup.commands} />, options);

  const first = pressEscape();
  setup.advance(300);
  const second = pressEscape();

  expect(first.defaultPrevented).toBe(false);
  expect(second.defaultPrevented).toBe(true);
  expect(setup.rewind).toHaveBeenCalledOnce();
});

it("does not open rewind on a single Escape or a slow second one", async () => {
  using setup = escapeChordSetup();
  await using _screen = await render(<Chat composerKeys={[]} commands={setup.commands} />, options);

  const single = pressEscape();
  setup.advance(700);
  const slow = pressEscape();

  expect(single.defaultPrevented).toBe(false);
  expect(slow.defaultPrevented).toBe(false);
  expect(setup.rewind).not.toHaveBeenCalled();
});

it("does not open rewind while an IME composition is active", async () => {
  using setup = escapeChordSetup();
  await using _screen = await render(<Chat composerKeys={[]} commands={setup.commands} />, options);

  pressEscape();
  setup.advance(100);
  pressEscape({ isComposing: true });
  setup.advance(100);
  pressEscape();

  expect(setup.rewind).not.toHaveBeenCalled();
});

it("does not open rewind when a dialog or menu is already open", async () => {
  using setup = escapeChordSetup();
  await using _screen = await render(<Chat composerKeys={[]} commands={setup.commands} />, options);
  const dialog = document.createElement("div");
  dialog.dataset.slot = "dialog-popup";
  dialog.dataset.open = "";
  document.body.append(dialog);

  pressEscape();
  setup.advance(100);
  pressEscape();
  dialog.remove();

  expect(setup.rewind).not.toHaveBeenCalled();
  setup.advance(100);
  pressEscape();
  setup.advance(100);
  pressEscape();
  expect(setup.rewind).toHaveBeenCalledOnce();
});

it("still opens rewind while a dismissed keepMounted popover stays in the DOM", async () => {
  using setup = escapeChordSetup();
  await using _screen = await render(<Chat composerKeys={[]} commands={setup.commands} />, options);
  const popover = document.createElement("div");
  popover.dataset.slot = "popover-popup";
  popover.dataset.closed = "";
  document.body.append(popover);

  pressEscape();
  setup.advance(100);
  pressEscape();
  popover.remove();

  expect(setup.rewind).toHaveBeenCalledOnce();
});

it("does not open rewind while the composer autocomplete is open", async () => {
  using setup = escapeChordSetup();
  await using _screen = await render(<Chat composerKeys={[]} commands={setup.commands} />, options);
  const menu = document.createElement("div");
  menu.dataset.composerCommandDrawer = "true";
  document.body.append(menu);

  pressEscape();
  setup.advance(100);
  pressEscape();
  menu.remove();

  expect(setup.rewind).not.toHaveBeenCalled();
});

it("does not open rewind while thread find is closing on Escape", async () => {
  using setup = escapeChordSetup();
  await using _screen = await render(
    <Chat composerKeys={[]} commands={setup.commands} threadFindActive />,
    options,
  );

  pressEscape();
  setup.advance(100);
  pressEscape();

  expect(setup.rewind).not.toHaveBeenCalled();
});

it("opens rewind only in the focused split pane", async () => {
  using setup = escapeChordSetup();
  const other = vi.fn();
  await using _screen = await render(
    <>
      <SplitPaneFocusContext value={false}>
        <Chat composerKeys={[]} commands={{ "thread.rewind": other }} />
      </SplitPaneFocusContext>
      <SplitPaneFocusContext value>
        <Chat composerKeys={[]} commands={setup.commands} />
      </SplitPaneFocusContext>
    </>,
    options,
  );

  pressEscape();
  setup.advance(100);
  pressEscape();

  expect(other).not.toHaveBeenCalled();
  expect(setup.rewind).toHaveBeenCalledOnce();
});
