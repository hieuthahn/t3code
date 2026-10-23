import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  type EnvironmentId,
  type ProjectId,
  type SavedEnvironment,
  resolveEnvironmentMachineKind,
} from "@t3tools/contracts";
import {
  EllipsisIcon,
  FolderIcon,
  LayersIcon,
  MessageSquareDashedIcon,
  PlusIcon,
} from "lucide-react";
import { useId, useState } from "react";

import { isElectron } from "../env";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useScratchProject } from "../hooks/useScratchProject";
import { updateClientSettings, useClientSettings } from "../hooks/useSettings";
import { randomUUID } from "../lib/utils";
import { useProjects, useThreadShells } from "../state/entities";
import {
  type EnvironmentPresentation,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../state/environments";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { resolveSavedEnvironmentLaunch } from "./NewSessionLanding.logic";
import { sortScopedProjectsForSidebar } from "./Sidebar.logic";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { DiscoveryList, DiscoveryListRow } from "./ui/discovery-list";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { SidebarInset } from "./ui/sidebar";
import { Switch } from "./ui/switch";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

const RECENT_PROJECT_LIMIT = 8;
const ROW_ICON_CLASS = "size-4 shrink-0 text-muted-foreground";

export function NewSessionLanding() {
  const projects = useProjects().filter((project) => project.isScratch !== true);
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const savedEnvironments = useClientSettings((settings) => settings.savedEnvironments);
  const handleNewThread = useNewThreadHandler();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const [editing, setEditing] = useState<SavedEnvironment | "new" | null>(null);

  const recentProjects = sortScopedProjectsForSidebar(projects, threads, "updated_at").slice(
    0,
    RECENT_PROJECT_LIMIT,
  );
  const scratchTargetEnvironmentId = scratchEnvironmentId(primaryEnvironmentId);
  const showMachine = environments.length > 1;
  const environmentFor = (environmentId: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === environmentId);

  const startProject = (project: EnvironmentProject) =>
    void handleNewThread(scopeProjectRef(project.environmentId, project.id), { replace: true });

  const launch = async (saved: SavedEnvironment) => {
    const resolved = resolveSavedEnvironmentLaunch(saved, projects);
    if (resolved.kind === "unavailable") {
      reportLaunchProblem(`None of the folders in ${saved.name} are on this machine anymore.`);
      return;
    }
    if (resolved.kind === "scratch") {
      if (scratchEnvironmentId(resolved.environmentId) === null) {
        reportLaunchProblem(
          `${environmentFor(resolved.environmentId)?.label ?? "That machine"} cannot start a thread without a project right now.`,
        );
        return;
      }
      await startScratchThread(resolved.environmentId);
      return;
    }
    // Opened last-to-first so the first folder's draft is the one left on screen.
    for (const projectRef of resolved.projectRefs.toReversed()) {
      await handleNewThread(projectRef, {
        replace: true,
        ...(resolved.envMode ? { envMode: resolved.envMode } : {}),
      });
    }
    if (resolved.missingFolderCount > 0) {
      reportLaunchProblem(
        `${resolved.missingFolderCount} ${resolved.missingFolderCount === 1 ? "folder" : "folders"} in ${saved.name} could not be found and were skipped.`,
      );
    }
  };

  const describeSaved = (saved: SavedEnvironment) => {
    const titles = saved.folders.flatMap((folder) => {
      const project = projects.find(
        (candidate) => candidate.environmentId === saved.environmentId && candidate.id === folder,
      );
      return project ? [project.title] : [];
    });
    return [
      environmentFor(saved.environmentId)?.label ?? "Unavailable machine",
      titles.length > 0 ? titles.join(", ") : "No project",
      saved.worktreePerFolder && titles.length > 0 ? "Worktree per folder" : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <div className="flex min-h-0 flex-1 justify-center overflow-y-auto px-4 py-12 scrollbar-gutter-both">
        <div className="flex w-full max-w-xl flex-col gap-8">
          <h1 className="font-semibold text-lg text-foreground">Start a thread</h1>

          <section className="flex flex-col gap-2" aria-labelledby="new-session-recent">
            <h2 id="new-session-recent" className="font-medium text-muted-foreground text-xs">
              Recent
            </h2>
            <DiscoveryList>
              {recentProjects.map((project) => (
                <DiscoveryListRow
                  key={`${project.environmentId}:${project.id}`}
                  icon={<FolderIcon className={ROW_ICON_CLASS} />}
                  title={project.title}
                  description={
                    showMachine
                      ? `${environmentFor(project.environmentId)?.label ?? ""} · ${project.workspaceRoot}`
                      : project.workspaceRoot
                  }
                  onClick={() => startProject(project)}
                />
              ))}
              {scratchTargetEnvironmentId === null ? null : (
                <DiscoveryListRow
                  icon={<MessageSquareDashedIcon className={ROW_ICON_CLASS} />}
                  title="No project"
                  description={environmentFor(scratchTargetEnvironmentId)?.label ?? ""}
                  onClick={() => void startScratchThread(scratchTargetEnvironmentId)}
                />
              )}
            </DiscoveryList>
          </section>

          <section className="flex flex-col gap-2" aria-labelledby="new-session-saved">
            <div className="flex items-center justify-between gap-2">
              <h2 id="new-session-saved" className="font-medium text-muted-foreground text-xs">
                Saved environments
              </h2>
              <Button size="xs" variant="ghost" onClick={() => setEditing("new")}>
                <PlusIcon className="size-3.5" />
                New
              </Button>
            </div>
            {savedEnvironments.length > 0 ? (
              <DiscoveryList>
                {savedEnvironments.map((saved) => (
                  <div key={saved.id} className="flex items-center">
                    <DiscoveryListRow
                      icon={<LayersIcon className={ROW_ICON_CLASS} />}
                      title={saved.name}
                      description={describeSaved(saved)}
                      onClick={() => void launch(saved)}
                    />
                    <Menu>
                      <MenuTrigger
                        render={
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="me-2 shrink-0"
                            aria-label={`${saved.name} options`}
                          />
                        }
                      >
                        <EllipsisIcon className="size-4" />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        <MenuItem onClick={() => setEditing(saved)}>Edit</MenuItem>
                        <MenuItem
                          variant="destructive"
                          onClick={() =>
                            void updateClientSettings({
                              savedEnvironments: savedEnvironments.filter(
                                (entry) => entry.id !== saved.id,
                              ),
                            })
                          }
                        >
                          Delete
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
                  </div>
                ))}
              </DiscoveryList>
            ) : null}
          </section>
        </div>
      </div>
      {editing === null ? null : (
        <SavedEnvironmentDialog
          initial={editing === "new" ? null : editing}
          projects={projects}
          threads={threads}
          environments={environments}
          defaultEnvironmentId={primaryEnvironmentId ?? environments[0]?.environmentId ?? null}
          onSave={(saved) => {
            const next =
              editing === "new"
                ? [...savedEnvironments, saved]
                : savedEnvironments.map((entry) => (entry.id === saved.id ? saved : entry));
            void updateClientSettings({ savedEnvironments: next });
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </SidebarInset>
  );
}

function reportLaunchProblem(description: string) {
  toastManager.add(stackedThreadToast({ type: "error", title: "Could not start", description }));
}

function SavedEnvironmentDialog({
  initial,
  projects,
  threads,
  environments,
  defaultEnvironmentId,
  onSave,
  onClose,
}: {
  readonly initial: SavedEnvironment | null;
  readonly projects: readonly EnvironmentProject[];
  readonly threads: ReturnType<typeof useThreadShells>;
  readonly environments: readonly EnvironmentPresentation[];
  readonly defaultEnvironmentId: EnvironmentId | null;
  readonly onSave: (saved: SavedEnvironment) => void;
  readonly onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [environmentId, setEnvironmentId] = useState(
    initial?.environmentId ?? defaultEnvironmentId,
  );
  const [folders, setFolders] = useState<readonly ProjectId[]>(initial?.folders ?? []);
  const [worktreePerFolder, setWorktreePerFolder] = useState(initial?.worktreePerFolder ?? false);

  const machineProjects = sortScopedProjectsForSidebar(
    projects.filter((project) => project.environmentId === environmentId),
    threads,
    "updated_at",
  );
  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && environmentId !== null;

  const toggleFolder = (projectId: ProjectId, checked: boolean) =>
    setFolders((current) =>
      checked ? [...current, projectId] : current.filter((folder) => folder !== projectId),
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) return;
            onSave({
              id: initial?.id ?? randomUUID(),
              name: trimmedName,
              environmentId,
              folders: folders.filter((folder) =>
                machineProjects.some((project) => project.id === folder),
              ),
              worktreePerFolder,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{initial ? "Edit environment" : "New environment"}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-name`}>Name</Label>
                <Input
                  id={`${id}-name`}
                  value={name}
                  maxLength={80}
                  autoComplete="off"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>

              {environments.length > 1 ? (
                <div className="flex flex-col gap-1.5">
                  <Label>Run on</Label>
                  <Select
                    value={environmentId}
                    onValueChange={(value) => {
                      if (value === null) return;
                      setEnvironmentId(value);
                      setFolders([]);
                    }}
                    items={environments.map((environment) => ({
                      value: environment.environmentId,
                      label: environment.label,
                    }))}
                  >
                    <SelectTrigger size="sm" aria-label="Run on">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {environments.map((environment) => (
                        <SelectItem
                          key={environment.environmentId}
                          value={environment.environmentId}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <EnvironmentMachineIcon
                              kind={resolveEnvironmentMachineKind(environment.serverConfig)}
                              className="size-3"
                            />
                            {environment.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <Label>Folders</Label>
                {machineProjects.length === 0 ? (
                  <p className="text-muted-foreground text-xs">No projects on this machine.</p>
                ) : (
                  <div className="max-h-56 overflow-y-auto rounded-md border">
                    {machineProjects.map((project) => (
                      <label
                        key={project.id}
                        className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm not-last:border-b"
                      >
                        <Checkbox
                          checked={folders.includes(project.id)}
                          onCheckedChange={(checked) => toggleFolder(project.id, checked)}
                        />
                        <span className="min-w-0 flex-1 truncate">{project.title}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <label className="flex items-center justify-between gap-3 text-sm">
                Worktree per folder
                <Switch
                  checked={worktreePerFolder}
                  disabled={folders.length === 0}
                  onCheckedChange={setWorktreePerFolder}
                />
              </label>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
