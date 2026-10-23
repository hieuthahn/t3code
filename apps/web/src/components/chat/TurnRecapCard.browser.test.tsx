import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { TurnRecapCard } from "./TurnRecapCard";

const RECAP = {
  summary: "The parser now accepts trailing commas. The full test suite has not run yet.",
  question: "Run the full suite now?",
  replies: ["Yes, run it", "Not now"],
};

it("sends the clicked reply as the next prompt and holds both buttons while it sends", async () => {
  let finishSend = () => {};
  const onReply = vi.fn(() => new Promise<void>((resolve) => (finishSend = resolve)));
  await using _screen = await render(<TurnRecapCard recap={RECAP} onReply={onReply} />, {
    router: false, // The card renders no links.
  });

  await expect.element(page.getByText(RECAP.summary)).toBeVisible();
  await expect.element(page.getByText(RECAP.question)).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Not now" }));

  expect(onReply).toHaveBeenCalledWith("Not now");
  await expect.element(page.getByRole("button", { name: "Yes, run it" })).toBeDisabled();
  await expect.element(page.getByRole("button", { name: "Not now" })).toBeDisabled();
  finishSend();
});

it("frees the buttons again when the reply could not be sent", async () => {
  const onReply = vi.fn(() => Promise.reject(new Error("Server unreachable")));
  await using _screen = await render(<TurnRecapCard recap={RECAP} onReply={onReply} />, {
    router: false, // The card renders no links.
  });

  await userEvent.click(page.getByRole("button", { name: "Yes, run it" }));

  expect(onReply).toHaveBeenCalledWith("Yes, run it");
  await expect.element(page.getByRole("button", { name: "Yes, run it" })).toBeEnabled();
});

it("shows only the summary when no decision is open", async () => {
  await using screen = await render(
    <TurnRecapCard recap={{ summary: RECAP.summary, replies: [] }} onReply={vi.fn()} />,
    { router: false }, // The card renders no links.
  );

  await expect.element(page.getByRole("region", { name: "Turn recap" })).toBeVisible();
  expect(screen.container.querySelectorAll("button")).toHaveLength(0);
});
