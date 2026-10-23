import { EnvironmentId, ProjectId, type SavedEnvironment } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveSavedEnvironmentLaunch } from "./NewSessionLanding.logic";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const web = ProjectId.make("project-web");
const projects = [
  { environmentId: local, id: web },
  { environmentId: remote, id: ProjectId.make("project-api") },
];

const saved = (overrides: Partial<SavedEnvironment>): SavedEnvironment => ({
  id: "env-1",
  name: "Frontend",
  environmentId: local,
  folder: null,
  worktree: false,
  ...overrides,
});

describe("resolveSavedEnvironmentLaunch", () => {
  it("starts without a project on the saved machine when it holds no folder", () => {
    expect(resolveSavedEnvironmentLaunch(saved({ environmentId: remote }), projects)).toEqual({
      kind: "scratch",
      environmentId: remote,
    });
  });

  it("opens the saved folder in a worktree when the toggle is on", () => {
    expect(resolveSavedEnvironmentLaunch(saved({ folder: web, worktree: true }), projects)).toEqual(
      {
        kind: "project",
        projectRef: { environmentId: local, projectId: web },
        envMode: "worktree",
      },
    );
  });

  it("leaves the project's own workspace default when the toggle is off", () => {
    const launch = resolveSavedEnvironmentLaunch(saved({ folder: web }), projects);

    expect(launch.kind === "project" ? launch.envMode : null).toBeUndefined();
  });

  it("reports a folder that is gone from the saved machine", () => {
    expect(
      resolveSavedEnvironmentLaunch(saved({ environmentId: remote, folder: web }), projects),
    ).toEqual({ kind: "unavailable" });
  });
});
