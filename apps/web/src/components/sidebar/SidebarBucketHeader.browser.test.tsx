import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { timeBucketMarker } from "../Sidebar.logic";
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
});
