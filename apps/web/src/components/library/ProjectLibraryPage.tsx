import type {
  EnvironmentId,
  OrchestrationListProjectLibraryResult,
  OrchestrationNestedRepository,
  OrchestrationProjectLibraryCursor,
  OrchestrationProjectLibraryEntry,
  ProjectId,
} from "@t3tools/contracts";
import { fileBasename } from "@t3tools/shared/path";
import { Link, useSearch } from "@tanstack/react-router";
import { FileIcon, GitBranchIcon, LibraryIcon } from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";

import { isElectron } from "~/env";
import { useEscapeToGoBack } from "../../hooks/useNavigateBack";
import { useNowSecond } from "../../hooks/useNowSecond";
import { useStableCallback } from "../../hooks/useStableCallback";
import { cn } from "../../lib/utils";
import { useProject } from "../../state/entities";
import { useNestedRepositories, useProjectLibraryPage } from "../../state/queries";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

import {
  ALL_REPOSITORIES_FILTER,
  OUTER_REPOSITORY_FILTER,
  applyRepositoryFilter,
  libraryScopeOfFilter,
  OUTSIDE_PROJECT_FILTER,
  OUTSIDE_PROJECT_LABEL,
  groupLibraryEntries,
  nestedRepositoryOfFilter,
  repositoryFilterValue,
} from "./libraryGroups";

const EMPTY_REPOSITORIES: ReadonlyArray<OrchestrationNestedRepository> = [];

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

type LibraryPage = OrchestrationListProjectLibraryResult;

function LibraryPageLoader(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly cursor: OrchestrationProjectLibraryCursor | null;
  readonly repository: string | null;
  readonly scope: "outer" | "outside" | undefined;
  readonly index: number;
  readonly onPage: (index: number, page: LibraryPage) => void;
}) {
  const { index, onPage } = props;
  const query = useProjectLibraryPage(props);
  useEffect(() => {
    if (query.data !== null) onPage(index, query.data);
  }, [index, onPage, query.data]);
  if (query.data !== null) return null;
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

function LibraryGroupHeader(props: { readonly label: string; readonly count: number }) {
  return (
    <li
      data-testid="library-group-header"
      className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-4 py-1.5 text-xs font-medium text-muted-foreground"
    >
      <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
      <h2 className="min-w-0 truncate font-medium">{props.label}</h2>
      <span className="ms-auto tabular-nums">{props.count}</span>
    </li>
  );
}

function RepositoryFilter(props: {
  readonly projectTitle: string;
  readonly repositories: readonly OrchestrationNestedRepository[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const labelOf = (value: string) =>
    value === ALL_REPOSITORIES_FILTER
      ? "All repositories"
      : value === OUTER_REPOSITORY_FILTER
        ? props.projectTitle
        : value === OUTSIDE_PROJECT_FILTER
          ? OUTSIDE_PROJECT_LABEL
          : (nestedRepositoryOfFilter(value) ?? value);
  return (
    <Select value={props.value} onValueChange={(value) => value !== null && props.onChange(value)}>
      <SelectTrigger size="sm" className="ms-auto w-44" aria-label="Filter by repository">
        <SelectValue>{labelOf(props.value)}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        <SelectItem hideIndicator value={ALL_REPOSITORIES_FILTER}>
          All repositories
        </SelectItem>
        <SelectItem hideIndicator value={OUTER_REPOSITORY_FILTER}>
          {props.projectTitle}
        </SelectItem>
        {props.repositories.map((repository) => (
          <SelectItem
            hideIndicator
            key={repository.path}
            value={repositoryFilterValue(repository.path)}
          >
            {repository.path}
          </SelectItem>
        ))}
        <SelectItem hideIndicator value={OUTSIDE_PROJECT_FILTER}>
          {OUTSIDE_PROJECT_LABEL}
        </SelectItem>
      </SelectPopup>
    </Select>
  );
}

function LibraryList(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectTitle: string;
  readonly repositories: readonly OrchestrationNestedRepository[];
  readonly filter: string;
}) {
  const nowMs = useNowSecond();
  const nestedRepository = nestedRepositoryOfFilter(props.filter);
  const [cursors, setCursors] = useState<ReadonlyArray<OrchestrationProjectLibraryCursor | null>>([
    null,
  ]);
  const [pages, setPages] = useState<ReadonlyArray<LibraryPage | undefined>>([]);
  const onPage = useStableCallback((index: number, page: LibraryPage) =>
    setPages((current) => {
      if (current[index] === page) return current;
      const next = [...current];
      next[index] = page;
      return next;
    }),
  );
  const loadedPages = cursors.map((_, index) => pages[index]);
  const lastPage = loadedPages.at(-1);
  const nextCursor = lastPage?.nextCursor ?? null;
  const entries = applyRepositoryFilter(
    loadedPages.flatMap((page) => page?.entries ?? []),
    props.filter,
  );
  const groups = groupLibraryEntries(entries, props);
  const firstPageEmpty = pages[0] !== undefined && pages[0].total === 0;
  if (firstPageEmpty && props.filter !== ALL_REPOSITORIES_FILTER) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LibraryIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>No files here</EmptyTitle>
          <EmptyDescription>No file changes match this repository filter.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (firstPageEmpty) {
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
  const row = (entry: OrchestrationProjectLibraryEntry) => (
    <LibraryRow key={entry.path} entry={entry} environmentId={props.environmentId} nowMs={nowMs} />
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ul className="m-0 flex list-none flex-col p-0">
        {groups.length === 0
          ? entries.map(row)
          : groups.map((group) => (
              <Fragment key={group.outsideProject ? "outside" : (group.repository ?? "outer")}>
                <LibraryGroupHeader label={group.label} count={group.entries.length} />
                {group.entries.map(row)}
              </Fragment>
            ))}
        {cursors.map((cursor, index) => (
          <LibraryPageLoader
            key={cursor === null ? "first" : `${cursor.changedAt}:${cursor.path}`}
            environmentId={props.environmentId}
            projectId={props.projectId}
            cursor={cursor}
            repository={nestedRepository}
            scope={libraryScopeOfFilter(props.filter)}
            index={index}
            onPage={onPage}
          />
        ))}
        {lastPage !== undefined && nextCursor !== null ? (
          <li className="flex justify-center p-3">
            <Button
              size="xs"
              variant="outline"
              onClick={() => setCursors([...cursors, nextCursor])}
            >
              Load more
            </Button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function LibraryHeader(props: {
  readonly projectTitle: string | null;
  readonly filter?: ReactNode;
}) {
  return (
    <WorkspacePageHeader electron={isElectron} className="bg-background">
      <WorkspaceBreadcrumb ariaLabel="Library breadcrumb" className="overflow-hidden">
        <WorkspaceBreadcrumbItem>Library</WorkspaceBreadcrumbItem>
        {props.projectTitle === null ? null : (
          <>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem current className="min-w-0">
              <h1 className="truncate">{props.projectTitle}</h1>
            </WorkspaceBreadcrumbItem>
          </>
        )}
      </WorkspaceBreadcrumb>
      {props.filter}
    </WorkspacePageHeader>
  );
}

function ProjectLibraryView(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const project = useProject(props);
  const projectTitle = project?.title ?? "Project";
  const repositories = useNestedRepositories(props).data?.repositories ?? EMPTY_REPOSITORIES;
  const [filter, setFilter] = useState(ALL_REPOSITORIES_FILTER);
  return (
    <>
      <LibraryHeader
        projectTitle={project?.title ?? null}
        filter={
          repositories.length === 0 ? null : (
            <RepositoryFilter
              projectTitle={projectTitle}
              repositories={repositories}
              value={filter}
              onChange={setFilter}
            />
          )
        }
      />
      <LibraryList
        key={filter}
        environmentId={props.environmentId}
        projectId={props.projectId}
        projectTitle={projectTitle}
        repositories={repositories}
        filter={filter}
      />
    </>
  );
}

/** Every file any thread in a project created, edited or deleted, grouped by repository and each linking to the last thread to touch it. */
export function ProjectLibraryPage() {
  useEscapeToGoBack();
  const { environmentId, projectId } = useSearch({ from: "/_chat/library" });
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {environmentId === undefined || projectId === undefined ? (
          <>
            <LibraryHeader projectTitle={null} />
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No project selected</EmptyTitle>
                <EmptyDescription>Open a project's Library from the sidebar.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </>
        ) : (
          <ProjectLibraryView environmentId={environmentId} projectId={projectId} />
        )}
      </div>
    </SidebarInset>
  );
}
