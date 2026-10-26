import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ThreadRepositorySelect } from "./ThreadRepositorySelect";
import type { RepositoryOption } from "./repositorySelection";

const options: readonly RepositoryOption[] = [
  { path: null, label: "Nojima", branch: "main", cwd: "/work/nojima" },
  { path: "backend", label: "backend", branch: "dev", cwd: "/work/nojima/backend" },
];

describe("ThreadRepositorySelect", () => {
  it("stays enabled when no git action runs", async () => {
    await using _screen = await render(
      <ThreadRepositorySelect
        options={options}
        selected={options[1] ?? null}
        onSelect={() => {}}
      />,
    );
    await expect.element(page.getByTestId("thread-repository-select")).toBeEnabled();
  });

  it("locks the choice while a git action runs", async () => {
    await using _screen = await render(
      <ThreadRepositorySelect
        options={options}
        selected={options[1] ?? null}
        onSelect={() => {}}
        disabled
      />,
    );
    await expect.element(page.getByTestId("thread-repository-select")).toBeDisabled();
  });
});
