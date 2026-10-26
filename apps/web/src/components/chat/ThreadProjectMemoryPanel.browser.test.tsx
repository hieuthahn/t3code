import { EnvironmentId, ProjectId, type ProjectMemoryEntry } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

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
      (row.querySelector("p")?.textContent ?? "").trim(),
    );
  const byLabel = (label: string) =>
    container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  const environment = stack.move();
  return {
    container,
    rows,
    byLabel,
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

it("edits an entry in place on Enter and leaves it alone on Escape", async () => {
  await using fixture = await setup([entry("memory:1", "Use pnpm")]);
  await act(async () => fixture.byLabel("Edit memory: Use pnpm")!.click());
  await userEvent.keyboard("{Escape}");
  expect(fixture.rows()).toEqual(["Use pnpm"]);
  expect(state.calls).toEqual([]);

  await act(async () => fixture.byLabel("Edit memory: Use pnpm")!.click());
  await userEvent.keyboard(" via vp{Enter}");
  expect(state.calls).toEqual([
    {
      action: "edit",
      input: { environmentId, input: { projectId, entryId: "memory:1", text: "Use pnpm via vp" } },
    },
  ]);
  expect(fixture.rows()).toEqual(["Use pnpm via vp"]);
  expect(fixture.byLabel("Edit memory")).toBeNull();
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

it("keeps the draft and shows the error when an edit fails, and survives a blur", async () => {
  await using fixture = await setup([entry("memory:1", "Use pnpm")], projectId, {
    failEdit: "Disk full",
  });
  await act(async () => fixture.byLabel("Edit memory: Use pnpm")!.click());
  await userEvent.keyboard(" via vp{Enter}");
  const field = fixture.byLabel("Edit memory") as HTMLInputElement;
  expect(field.value).toBe("Use pnpm via vp");
  expect(fixture.container.textContent).toContain("Disk full");
  await act(async () => void field.blur());
  expect(fixture.byLabel("Edit memory")).not.toBeNull();
});
