import { EnvironmentId, ProjectId, type ProjectMemoryEntry } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

const state = vi.hoisted(() => ({
  allowed: true,
  loading: false,
  failEdit: null as string | null,
  entries: [] as ProjectMemoryEntry[],
  queryAtoms: [] as unknown[],
  calls: [] as Array<{ readonly action: string; readonly input: unknown }>,
}));
vi.mock(import("../../state/session"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentScope: () => state.allowed,
  readEnvironmentScope: () => state.allowed,
}));
// The panel reads the operate permission through an atom; the grant is the boundary under test.
vi.mock(import("@effect/atom-react"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomValue: (() => state.allowed) as never,
}));
// The commands stand in for the server: each one changes the entries the live query then reports.
vi.mock(import("../../state/use-atom-command"), async (importOriginal) => {
  const { serverEnvironment } = await import("../../state/server");
  const run = (action: string, input: unknown) => {
    state.calls.push({ action, input });
    if (action === "edit" && state.failEdit !== null) {
      return { _tag: "Failure", cause: Cause.fail(new Error(state.failEdit)) };
    }
    const { input: body } = input as {
      input: { entryId?: string; text?: string; projectId: string };
    };
    if (action === "append") {
      state.entries = [
        {
          id: `memory:${state.entries.length + 1}`,
          projectId: body.projectId,
          text: body.text,
          createdAt: "2026-10-26T00:00:00.000Z",
          updatedAt: "2026-10-26T00:00:00.000Z",
        } as ProjectMemoryEntry,
        ...state.entries,
      ];
    } else if (action === "edit") {
      state.entries = state.entries.map((entry) =>
        entry.id === body.entryId ? { ...entry, text: body.text! } : entry,
      );
    } else {
      state.entries = state.entries.filter((entry) => entry.id !== body.entryId);
    }
    return { _tag: "Success" };
  };
  const actions = new Map<unknown, string>([
    [serverEnvironment.appendProjectMemory, "append"],
    [serverEnvironment.editProjectMemory, "edit"],
    [serverEnvironment.deleteProjectMemory, "delete"],
  ]);
  return {
    ...(await importOriginal()),
    useAtomCommand: ((command: unknown) => async (input: unknown) =>
      run(actions.get(command) ?? "unknown", input)) as never,
  };
});
vi.mock(import("../../state/query"), async (importOriginal) => ({
  ...(await importOriginal()),
  useEnvironmentQuery: ((atom: unknown) => {
    state.queryAtoms.push(atom);
    return { data: atom === null || state.loading ? null : state.entries, error: null };
  }) as never,
}));

import { act, render as renderUi } from "../../../test/render";
import { ThreadProjectMemoryPanel } from "./ThreadProjectMemoryPanel";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project:t3");

const entry = (id: string, text: string): ProjectMemoryEntry =>
  ({
    id,
    projectId,
    text,
    createdAt: "2026-10-25T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z",
  }) as ProjectMemoryEntry;

async function setup(
  entries: ProjectMemoryEntry[],
  project: ProjectId | null = projectId,
  options: { readonly loading?: boolean; readonly failEdit?: string } = {},
) {
  state.allowed = true;
  state.loading = options.loading ?? false;
  state.failEdit = options.failEdit ?? null;
  state.entries = entries;
  state.queryAtoms = [];
  state.calls = [];
  await using stack = new AsyncDisposableStack();
  const screen = stack.use(await renderUi(null));
  const show = async (next: ProjectId | null) =>
    act(
      async () =>
        await screen.rerender(
          <ThreadProjectMemoryPanel environmentId={environmentId} projectId={next} />,
        ),
    );
  await show(project);
  const container = screen.container;
  const rows = () =>
    Array.from(container.querySelectorAll<HTMLElement>("[data-memory-entry-id]")).map((row) =>
      (row.querySelector("[data-memory-entry-text]")?.textContent ?? "").trim(),
    );
  const byLabel = (label: string) =>
    container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  const dialog = () => document.querySelector<HTMLElement>("[data-thread-project-memory-dialog]");
  const dialogField = () =>
    dialog()?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Memory text"]') ?? null;
  const dialogButton = (name: string) =>
    Array.from(dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      (button) => button.textContent === name,
    ) ?? null;
  const environment = stack.move();
  return {
    container,
    rows,
    byLabel,
    dialog,
    dialogField,
    dialogButton,
    show,
    [Symbol.asyncDispose]: () => environment.disposeAsync(),
  };
}

it("shows nothing and subscribes to nothing for a thread without a project", async () => {
  await using fixture = await setup([entry("memory:1", "Use pnpm")], null);
  expect(fixture.container.querySelector("[data-thread-project-memory-panel]")).toBeNull();
  expect(state.queryAtoms.every((atom) => atom === null)).toBe(true);
});

it("says so when the project has no memory yet", async () => {
  await using fixture = await setup([]);
  expect(fixture.container.textContent).toContain("Nothing saved yet.");
  expect(fixture.rows()).toEqual([]);
});

it("lists entries in the order the live query reports and follows each new snapshot", async () => {
  await using fixture = await setup([
    entry("memory:2", "Ship small"),
    entry("memory:1", "Use pnpm"),
  ]);
  expect(fixture.rows()).toEqual(["Ship small", "Use pnpm"]);

  state.entries = [entry("memory:3", "No em dashes"), ...state.entries];
  await fixture.show(projectId);
  expect(fixture.rows()).toEqual(["No em dashes", "Ship small", "Use pnpm"]);
  expect(fixture.container.textContent).not.toContain("Nothing saved yet.");
});

it("adds an entry from the field and clears the field", async () => {
  await using fixture = await setup([entry("memory:1", "Use pnpm")]);
  const field = fixture.byLabel("Add to memory") as HTMLInputElement;
  await userEvent.click(field);
  await userEvent.keyboard("Prefer Effect services{Enter}");
  expect(state.calls).toEqual([
    {
      action: "append",
      input: { environmentId, input: { projectId, text: "Prefer Effect services" } },
    },
  ]);
  expect(fixture.rows()).toEqual(["Prefer Effect services", "Use pnpm"]);
  expect(field.value).toBe("");
});

it("ignores a blank field", async () => {
  await using fixture = await setup([]);
  await userEvent.click(fixture.byLabel("Add to memory")!);
  await userEvent.keyboard("   {Enter}");
  expect(state.calls).toEqual([]);
});

it("deletes the entry whose control was pressed", async () => {
  await using fixture = await setup([
    entry("memory:2", "Ship small"),
    entry("memory:1", "Use pnpm"),
  ]);
  await act(async () => fixture.byLabel("Delete memory: Ship small")!.click());
  expect(state.calls).toEqual([
    { action: "delete", input: { environmentId, input: { projectId, entryId: "memory:2" } } },
  ]);
  expect(fixture.rows()).toEqual(["Use pnpm"]);
});

const LONG_TEXT = Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ");
const textOfLength = (length: number) => "x".repeat(length);

async function typeIntoDialog(
  fixture: { dialogField: () => HTMLTextAreaElement | null },
  text: string,
) {
  const field = fixture.dialogField()!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("clamps a long entry to two lines in the rail", async () => {
  await using fixture = await setup([entry("memory:1", LONG_TEXT)]);
  const text = fixture.container.querySelector<HTMLElement>("[data-memory-entry-text]")!;
  expect(getComputedStyle(text).webkitLineClamp).toBe("2");
  expect(text.scrollHeight).toBeGreaterThan(text.clientHeight);
  expect(text.clientHeight).toBeLessThanOrEqual(
    Number.parseFloat(getComputedStyle(text).lineHeight) * 2 + 1,
  );
  expect(fixture.dialog()).toBeNull();
});

it("opens an entry in a dialog with its full text and a character counter", async () => {
  await using fixture = await setup([entry("memory:1", LONG_TEXT)]);
  await act(async () =>
    fixture.container.querySelector<HTMLElement>("[data-memory-entry-open]")!.click(),
  );
  expect(fixture.dialogField()!.value).toBe(LONG_TEXT);
  expect(fixture.dialog()!.querySelector("[data-memory-counter]")!.textContent).toBe(
    `${LONG_TEXT.length}/500`,
  );
  expect(fixture.dialogButton("Delete")).not.toBeNull();
  expect(state.calls).toEqual([]);
});

it("opens the same dialog from the edit control", async () => {
  await using fixture = await setup([entry("memory:1", "Use pnpm")]);
  await act(async () => fixture.byLabel("Edit memory: Use pnpm")!.click());
  expect(fixture.dialogField()!.value).toBe("Use pnpm");
});

it("saves an edited entry from the dialog and closes it", async () => {
  await using fixture = await setup([entry("memory:1", "Use pnpm")]);
  await act(async () => fixture.byLabel("Edit memory: Use pnpm")!.click());
  expect(fixture.dialogButton("Save")!.disabled).toBe(true);
  await typeIntoDialog(fixture, "Use pnpm via vp");
  await act(async () => fixture.dialogButton("Save")!.click());
  expect(state.calls).toEqual([
    {
      action: "edit",
      input: { environmentId, input: { projectId, entryId: "memory:1", text: "Use pnpm via vp" } },
    },
  ]);
  expect(fixture.rows()).toEqual(["Use pnpm via vp"]);
  await vi.waitFor(() => expect(fixture.dialog()).toBeNull());
});

it("saves from the keyboard with Cmd+Enter and keeps Enter for a new line", async () => {
  await using fixture = await setup([entry("memory:1", "Use pnpm")]);
  await act(async () => fixture.byLabel("Edit memory: Use pnpm")!.click());
  const field = fixture.dialogField()!;
  await act(async () => field.setSelectionRange(field.value.length, field.value.length));
  await userEvent.keyboard("{Enter}more");
  expect(state.calls).toEqual([]);
  expect(fixture.dialogField()!.value).toBe("Use pnpm\nmore");
  await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
  expect(state.calls).toHaveLength(1);
});

it("blocks a save over 500 characters and allows exactly 500", async () => {
  await using fixture = await setup([entry("memory:1", "Use pnpm")]);
  await act(async () => fixture.byLabel("Edit memory: Use pnpm")!.click());
  await typeIntoDialog(fixture, textOfLength(501));
  expect(fixture.dialog()!.querySelector("[data-memory-counter]")!.textContent).toBe("501/500");
  expect(fixture.dialogButton("Save")!.disabled).toBe(true);
  await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
  expect(state.calls).toEqual([]);
  expect(fixture.rows()).toEqual(["Use pnpm"]);

  await typeIntoDialog(fixture, textOfLength(500));
  expect(fixture.dialogButton("Save")!.disabled).toBe(false);
});

it("leaves everything unchanged on Cancel and on Escape", async () => {
  await using fixture = await setup([entry("memory:1", "Use pnpm")]);
  await act(async () => fixture.byLabel("Edit memory: Use pnpm")!.click());
  await typeIntoDialog(fixture, "Something else");
  await act(async () => fixture.dialogButton("Cancel")!.click());
  await vi.waitFor(() => expect(fixture.dialog()).toBeNull());
  expect(fixture.rows()).toEqual(["Use pnpm"]);

  await act(async () => fixture.byLabel("Edit memory: Use pnpm")!.click());
  expect(fixture.dialogField()!.value).toBe("Use pnpm");
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(fixture.dialog()).toBeNull());
  expect(fixture.rows()).toEqual(["Use pnpm"]);
  expect(state.calls).toEqual([]);
});

it("keeps the dialog open with the draft and the error when a save fails", async () => {
  await using fixture = await setup([entry("memory:1", "Use pnpm")], projectId, {
    failEdit: "Disk full",
  });
  await act(async () => fixture.byLabel("Edit memory: Use pnpm")!.click());
  await typeIntoDialog(fixture, "Use pnpm via vp");
  await act(async () => fixture.dialogButton("Save")!.click());
  expect(fixture.dialog()).not.toBeNull();
  expect(fixture.dialogField()!.value).toBe("Use pnpm via vp");
  expect(fixture.dialog()!.querySelector('[role="alert"]')!.textContent).toContain("Disk full");
  expect(fixture.rows()).toEqual(["Use pnpm"]);
  expect(fixture.dialogButton("Save")!.disabled).toBe(false);
});

it("deletes an existing entry from the dialog", async () => {
  await using fixture = await setup([
    entry("memory:2", "Ship small"),
    entry("memory:1", "Use pnpm"),
  ]);
  await act(async () => fixture.byLabel("Edit memory: Ship small")!.click());
  await act(async () => fixture.dialogButton("Delete")!.click());
  expect(state.calls).toEqual([
    { action: "delete", input: { environmentId, input: { projectId, entryId: "memory:2" } } },
  ]);
  expect(fixture.rows()).toEqual(["Use pnpm"]);
  await vi.waitFor(() => expect(fixture.dialog()).toBeNull());
});

it("opens the editor from the add row with the draft and appends on save", async () => {
  await using fixture = await setup([entry("memory:1", "Use pnpm")]);
  const field = fixture.byLabel("Add to memory") as HTMLInputElement;
  await userEvent.click(field);
  await userEvent.keyboard("Draft so far");
  await act(async () => fixture.byLabel("Write a longer memory")!.click());
  expect(fixture.dialogField()!.value).toBe("Draft so far");
  expect(fixture.dialogButton("Delete")).toBeNull();

  await typeIntoDialog(fixture, `${LONG_TEXT}`);
  await act(async () => fixture.dialogButton("Save")!.click());
  expect(state.calls).toEqual([
    { action: "append", input: { environmentId, input: { projectId, text: LONG_TEXT } } },
  ]);
  expect(fixture.rows()).toEqual([LONG_TEXT, "Use pnpm"]);
  expect(field.value).toBe("");
});

it("keeps the add row draft when the editor is cancelled", async () => {
  await using fixture = await setup([]);
  const field = fixture.byLabel("Add to memory") as HTMLInputElement;
  await userEvent.click(field);
  await userEvent.keyboard("Draft so far");
  await act(async () => fixture.byLabel("Write a longer memory")!.click());
  await act(async () => fixture.dialogButton("Cancel")!.click());
  await vi.waitFor(() => expect(fixture.dialog()).toBeNull());
  expect(field.value).toBe("Draft so far");
  expect(state.calls).toEqual([]);
});

it("disables every control without the operate grant", async () => {
  await using fixture = await setup([entry("memory:1", "Use pnpm")]);
  state.allowed = false;
  await fixture.show(projectId);
  for (const label of ["Add to memory", "Edit memory: Use pnpm", "Delete memory: Use pnpm"]) {
    expect((fixture.byLabel(label) as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);
  }
});

it("does not claim the memory is empty while it is still loading", async () => {
  await using fixture = await setup([], projectId, { loading: true });
  expect(fixture.container.textContent).not.toContain("Nothing saved yet.");
  state.loading = false;
  await fixture.show(projectId);
  expect(fixture.container.textContent).toContain("Nothing saved yet.");
});

it("keeps Enter for the IME while a composition is open", async () => {
  await using fixture = await setup([entry("memory:1", "Use pnpm")]);
  const field = fixture.byLabel("Add to memory") as HTMLInputElement;
  await userEvent.click(field);
  await userEvent.keyboard("xin chao");
  const composing = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
  Object.defineProperty(composing, "isComposing", { value: true });
  await act(async () => void field.dispatchEvent(composing));
  expect(state.calls).toEqual([]);
  await act(
    async () =>
      void field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(state.calls).toHaveLength(1);
});
