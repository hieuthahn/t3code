import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { ProjectLibraryPage } from "../components/library/ProjectLibraryPage";

export interface ProjectLibrarySearch {
  environmentId?: EnvironmentId;
  projectId?: ProjectId;
}

export const Route = createFileRoute("/_chat/library")({
  validateSearch: (raw: Record<string, unknown>): ProjectLibrarySearch => ({
    ...(typeof raw.environmentId === "string" && raw.environmentId
      ? { environmentId: raw.environmentId as EnvironmentId }
      : {}),
    ...(typeof raw.projectId === "string" && raw.projectId
      ? { projectId: raw.projectId as ProjectId }
      : {}),
  }),
  component: ProjectLibraryPage,
});
