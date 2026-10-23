import { EnvironmentId, ProjectId, type SavedEnvironment } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveSavedEnvironmentLaunch } from "./NewSessionLanding.logic";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const web = ProjectId.make("project-web");
const api = ProjectId.make("project-api");
const projects = [
  { environmentId: local, id: web },
  { environmentId: local, id: api },
  { environmentId: remote, id: web },
];

const saved = (overrides: Partial<SavedEnvironment>): SavedEnvironment => ({
  id: "env-1",
  name: "Frontend",
  environmentId: local,
  folders: [],
  worktreePerFolder: false,
  ...overrides,
});

describe("resolveSavedEnvironmentLaunch", () => {
  it("starts without a project on the saved machine when it holds no folders", () => {
    expect(resolveSavedEnvironmentLaunch(saved({ environmentId: remote }), projects)).toEqual({
      kind: "scratch",
      environmentId: remote,
    });
  });

  it("opens one draft per folder in order, each in a worktree when the toggle is on", () => {
    expect(
      resolveSavedEnvironmentLaunch(
        saved({ folders: [api, web], worktreePerFolder: true }),
        projects,
      ),
    ).toEqual({
      kind: "folders",
      projectRefs: [
        { environmentId: local, projectId: api },
        { environmentId: local, projectId: web },
      ],
      envMode: "worktree",
      missingFolderCount: 0,
    });
  });

  it("leaves the project's own workspace default when the toggle is off", () => {
    const launch = resolveSavedEnvironmentLaunch(saved({ folders: [web] }), projects);

    expect(launch.kind === "folders" ? launch.envMode : null).toBeUndefined();
  });

  it("skips folders that are gone from the saved machine and counts them", () => {
    const gone = ProjectId.make("project-gone");

    expect(resolveSavedEnvironmentLaunch(saved({ folders: [gone, web] }), projects)).toMatchObject({
      kind: "folders",
      projectRefs: [{ environmentId: local, projectId: web }],
      missingFolderCount: 1,
    });
    expect(resolveSavedEnvironmentLaunch(saved({ folders: [gone] }), projects)).toEqual({
      kind: "unavailable",
    });
  });
});
