import { useAtomValue } from "@effect/atom-react";
import { Fragment } from "react";

import { useKeyboardShortcutsDialogStore } from "../keyboardShortcutsDialogStore";
import { isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import { buildShortcutSections } from "./KeyboardShortcutsDialog.logic";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "./ui/dialog";
import { Kbd, KbdGroup } from "./ui/kbd";

function ShortcutSections() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const sections = buildShortcutSections(keybindings, isMacPlatform(navigator.platform));
  return (
    <div className="gap-x-10 sm:columns-2" data-testid="keyboard-shortcuts-sections">
      {sections.map((section) => (
        <section key={section.id} className="mb-5 break-inside-avoid">
          <h3 className="mb-1 font-medium text-muted-foreground text-xs">{section.title}</h3>
          <dl>
            {section.rows.map((row) => (
              <div key={row.command} className="flex items-center justify-between gap-3 py-1">
                <dt className="min-w-0 text-sm">{row.label}</dt>
                <dd className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {row.chords.map((chord, chordIndex) => (
                    <Fragment key={chord.join("\u0000")}>
                      {chordIndex > 0 ? (
                        <span className="text-muted-foreground text-xs">or</span>
                      ) : null}
                      <KbdGroup>
                        {chord.map((cap, index) => (
                          <Kbd key={chord.slice(0, index + 1).join("\u0000")}>{cap}</Kbd>
                        ))}
                      </KbdGroup>
                    </Fragment>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

export function KeyboardShortcutsDialogHost() {
  const open = useKeyboardShortcutsDialogStore((state) => state.open);
  const setOpen = useKeyboardShortcutsDialogStore((state) => state.setOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <DialogPanel>{open ? <ShortcutSections /> : null}</DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
