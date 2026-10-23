import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { statusBucketMarker, timeBucketMarker } from "../Sidebar.logic";
import { SidebarBucketHeader } from "./SidebarListMarkers";

function header(expanded: boolean, onToggle: () => void) {
  return (
    <ul>
      <SidebarBucketHeader
        marker={timeBucketMarker("active", "today")}
        label="Today"
        threadCount={4}
        expanded={expanded}
        onToggle={onToggle}
      />
    </ul>
  );
}

describe("SidebarBucketHeader", () => {
  it("names its state and toggles on click", async () => {
    const onToggle = vi.fn();
    await using screen = await render(header(true, onToggle));
    const button = screen.container.querySelector<HTMLButtonElement>("button");

    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(button?.textContent).toContain("Today");
    await act(() => button?.click());
    expect(onToggle).toHaveBeenCalledTimes(1);

    await screen.rerender(header(false, onToggle));
    expect(button?.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles from the keyboard with Enter and Space", async () => {
    const onToggle = vi.fn();
    await using screen = await render(header(true, onToggle));
    screen.container.querySelector<HTMLButtonElement>("button")?.focus();

    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("marks a project group and names it in full on hover", async () => {
    await using screen = await render(
      <ul>
        <SidebarBucketHeader
          marker={timeBucketMarker("active", "today")}
          label="hora-skills-ort-furo"
          threadCount={4}
          expanded
          onToggle={() => {}}
          project={null}
        />
      </ul>,
    );
    const header = screen.container.querySelector("[data-testid=sidebar-bucket-header]");

    expect(header?.getAttribute("data-kind")).toBe("project");
    await userEvent.hover(header!.querySelector("[data-slot=tooltip-trigger]")!);
    await expect
      .poll(() => document.querySelector("[data-slot=tooltip-popup]")?.textContent)
      .toBe("hora-skills-ort-furo");
  });

  it("marks a status group with no pin or reorder control", async () => {
    await using screen = await render(
      <ul>
        <SidebarBucketHeader
          marker={statusBucketMarker("active", "needs-input")}
          label="Needs input"
          threadCount={2}
          expanded
          onToggle={() => {}}
          status="needs-input"
        />
      </ul>,
    );
    const header = screen.container.querySelector("[data-testid=sidebar-bucket-header]");

    expect(header?.getAttribute("data-kind")).toBe("status");
    expect(header?.querySelector("button")?.textContent).toBe("Needs input2 threads");
    expect(header?.querySelector("[aria-label='Pin project']")).toBeNull();
    expect(header?.querySelector("[data-project-group]")).toBeNull();
  });

  it("pins and unpins a project group from its header", async () => {
    const onPinnedChange = vi.fn();
    const header = (pinned: boolean) => (
      <ul>
        <SidebarBucketHeader
          marker={timeBucketMarker("active", "today")}
          label="hora-skills-ort-furo"
          threadCount={4}
          expanded
          onToggle={() => {}}
          project={null}
          pinned={pinned}
          onPinnedChange={onPinnedChange}
        />
      </ul>
    );
    await using screen = await render(header(false));

    await act(() =>
      screen.container.querySelector<HTMLButtonElement>("[aria-label='Pin project']")?.click(),
    );
    expect(onPinnedChange).toHaveBeenLastCalledWith(true);

    await screen.rerender(header(true));
    expect(screen.container.querySelector("[aria-label='Pinned']")).not.toBeNull();
    await act(() =>
      screen.container.querySelector<HTMLButtonElement>("[aria-label='Unpin project']")?.click(),
    );
    expect(onPinnedChange).toHaveBeenLastCalledWith(false);
  });
});
