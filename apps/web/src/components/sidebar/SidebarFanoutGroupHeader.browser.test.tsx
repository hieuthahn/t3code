import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { fanoutGroupMarker } from "../Sidebar.logic";
import { SidebarFanoutGroupHeader } from "./SidebarListMarkers";

function header(props: {
  readonly lineage?: boolean;
  readonly onToggle?: () => void;
  readonly onSelectMembers?: () => void;
}) {
  return (
    <ul>
      <SidebarFanoutGroupHeader
        marker={fanoutGroupMarker("active", "lineage:env-1:thread-root")}
        label={props.lineage ? "2 child sessions · 1 working · 1 done" : "Compare sorting"}
        memberCount={2}
        expanded
        {...(props.lineage === undefined ? {} : { lineage: props.lineage })}
        onToggle={props.onToggle ?? (() => {})}
        onSelectMembers={props.onSelectMembers ?? (() => {})}
        onCompare={() => {}}
      />
    </ul>
  );
}

describe("SidebarFanoutGroupHeader", () => {
  it("heads child sessions with their states and no model count", async () => {
    const onToggle = vi.fn();
    const onSelectMembers = vi.fn();
    await using screen = await render(header({ lineage: true, onToggle, onSelectMembers }));
    const [toggle, compare] = screen.container.querySelectorAll<HTMLButtonElement>("button");

    expect(toggle?.textContent).toBe("2 child sessions · 1 working · 1 done");
    expect(compare?.getAttribute("aria-label")).toBe("Compare 2 child sessions");
    await act(() => toggle?.click());
    expect(onToggle).toHaveBeenCalledTimes(1);
    await act(() =>
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })),
    );
    expect(onSelectMembers).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps the model count on a multiple-models header", async () => {
    await using screen = await render(header({}));
    const [toggle, compare] = screen.container.querySelectorAll<HTMLButtonElement>("button");

    expect(toggle?.textContent).toBe("Compare sorting×22 models");
    expect(compare?.getAttribute("aria-label")).toBe("Compare 2 models for Compare sorting");
  });
});
