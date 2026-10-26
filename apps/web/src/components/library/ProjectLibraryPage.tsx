import type {
  EnvironmentId,
  OrchestrationProjectLibraryEntry,
  ProjectId,
} from "@t3tools/contracts";
import { fileBasename } from "@t3tools/shared/path";
import { Link, useSearch } from "@tanstack/react-router";
import { FileIcon, LibraryIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "~/env";
import { useEscapeToGoBack } from "../../hooks/useNavigateBack";
import { useNowSecond } from "../../hooks/useNowSecond";
import { cn } from "../../lib/utils";
import { ORCHESTRATION_PROJECT_LIBRARY_PAGE_LIMIT } from "@t3tools/contracts";
import { useProject } from "../../state/entities";
import { useProjectLibraryPage } from "../../state/queries";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

const STATUS_BADGE = {
  created: { label: "Created", variant: "success" },
  edited: { label: "Edited", variant: "info" },
  deleted: { label: "Deleted", variant: "error" },
} as const;

function directoryOf(path: string): string {
  const base = fileBasename(path);
  return path.length > base.length ? path.slice(0, path.length - base.length - 1) : "";
}

function LibraryRow(props: {
  readonly entry: OrchestrationProjectLibraryEntry;
  readonly environmentId: EnvironmentId;
  readonly nowMs: number;
}) {
  const { entry } = props;
  const badge = STATUS_BADGE[entry.status];
  const directory = directoryOf(entry.path);
  return (
    <li>
      <Link
        to="/$environmentId/$threadId"
        params={buildThreadRouteParams({
          environmentId: props.environmentId,
          threadId: entry.threadId,
        })}
        className="flex min-h-12 items-center gap-3 px-4 py-2 outline-none hover:bg-accent/50 focus-visible:bg-accent/50"
      >
        <FileIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm text-foreground",
              entry.status === "deleted" && "line-through opacity-70",
            )}
          >
            {fileBasename(entry.path)}
          </span>
          {directory === "" ? null : (
            <span className="block truncate text-xs text-muted-foreground">{directory}</span>
          )}
        </span>
        <Badge variant={badge.variant} size="sm">
          {badge.label}
        </Badge>
        <span className="hidden w-56 min-w-0 shrink-0 sm:block">
          <span className="block truncate text-sm text-foreground/80">{entry.threadTitle}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {formatRelativeTimeLabel(entry.changedAt, props.nowMs)}
          </span>
        </span>
      </Link>
    </li>
  );
}

function LibraryPageRows(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly offset: number;
  readonly isLast: boolean;
  readonly onLoadMore: () => void;
  readonly nowMs: number;
}) {
  const query = useProjectLibraryPage(props);
  if (query.data === null) {
    return (
      <li className="flex justify-center p-6">
        {query.error === null ? (
          <Spinner aria-label="Loading library" />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground">Could not load the library.</p>
            <Button size="xs" variant="outline" onClick={query.refresh}>
              Retry
            </Button>
          </div>
        )}
      </li>
    );
  }
  const { entries, nextOffset } = query.data;
  return (
    <>
      {entries.map((entry) => (
        <LibraryRow
          key={entry.path}
          entry={entry}
          environmentId={props.environmentId}
          nowMs={props.nowMs}
        />
      ))}
      {props.isLast && nextOffset !== null ? (
        <li className="flex justify-center p-3">
          <Button size="xs" variant="outline" onClick={props.onLoadMore}>
            Load more
          </Button>
        </li>
      ) : null}
    </>
  );
}

function ProjectLibraryBody(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const nowMs = useNowSecond();
  const [pageCount, setPageCount] = useState(1);
  const firstPage = useProjectLibraryPage({ ...props, offset: 0 });
  if (firstPage.data !== null && firstPage.data.total === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LibraryIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>No files yet</EmptyTitle>
          <EmptyDescription>
            Files that threads in this project create, edit or delete appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
        {Array.from({ length: pageCount }, (_, index) => (
          <LibraryPageRows
            key={index}
            environmentId={props.environmentId}
            projectId={props.projectId}
            offset={index * ORCHESTRATION_PROJECT_LIBRARY_PAGE_LIMIT}
            isLast={index === pageCount - 1}
            onLoadMore={() => setPageCount(index + 2)}
            nowMs={nowMs}
          />
        ))}
      </ul>
    </div>
  );
}

/** Every file any thread in a project created, edited or deleted, each linking to the last thread to touch it. */
export function ProjectLibraryPage() {
  useEscapeToGoBack();
  const { environmentId, projectId } = useSearch({ from: "/_chat/library" });
  const project = useProject(
    environmentId !== undefined && projectId !== undefined ? { environmentId, projectId } : null,
  );
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="bg-background">
          <WorkspaceBreadcrumb ariaLabel="Library breadcrumb" className="overflow-hidden">
            <WorkspaceBreadcrumbItem>Library</WorkspaceBreadcrumbItem>
            {project === null ? null : (
              <>
                <WorkspaceBreadcrumbSeparator />
                <WorkspaceBreadcrumbItem current className="min-w-0">
                  <h1 className="truncate">{project.title}</h1>
                </WorkspaceBreadcrumbItem>
              </>
            )}
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>
        {environmentId === undefined || projectId === undefined ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No project selected</EmptyTitle>
              <EmptyDescription>Open a project's Library from the sidebar.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ProjectLibraryBody environmentId={environmentId} projectId={projectId} />
        )}
      </div>
    </SidebarInset>
  );
}
