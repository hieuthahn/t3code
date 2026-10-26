import { ThreadRepositorySelect } from "./ThreadRepositorySelect";
import { useSourceControlActionRunning } from "../../lib/sourceControlActions";
import { RUNNING_SOURCE_CONTROL_ACTIONS } from "../GitActionsControl.logic";
import { useThreadRepositories } from "./useThreadRepositories";
import type {
  EditorId,
  EnvironmentId,
  OrchestrationV2McpServerStatus,
  ProjectId,
  ProjectScript,
  ResolvedKeybindingsConfig,
  ThreadId,
} from "@t3tools/contracts";

import type { DraftId } from "../../composerDraftStore";
import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import type { ThreadOutput } from "../../lib/threadOutputs";
import { useT3ProjectFileScripts } from "../../hooks/useT3ProjectFileScripts";
import { type EnvMode, type EnvironmentOption } from "../BranchToolbar.logic";
import { BranchToolbar } from "../BranchToolbar";
import BaseGitActionsControl from "../GitActionsControl";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { memo, type ComponentProps } from "react";
import { ThreadDetailsCard } from "./ThreadDetailsCard";
import { OpenInPicker } from "./OpenInPicker";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { threadDetailsPanels } from "./threadDetailsCardLayout";
import { ThreadAutomationsPanel } from "./ThreadAutomationsPanel";
import { ThreadMergeQueuePanel } from "./ThreadMergeQueuePanel";
import { ThreadTeamPanel } from "./ThreadTeamPanel";
import { ThreadRelationshipsPanel } from "./ThreadRelationshipsControl";
import { ThreadConnectorsPanel } from "./ThreadConnectorsPanel";
import { ThreadContextPanel } from "./ThreadContextPanel";
import { ThreadOutputsPanel } from "./ThreadOutputsPanel";
import { ThreadProjectMemoryPanel } from "./ThreadProjectMemoryPanel";

const GitActionsControl = memo(BaseGitActionsControl);

export interface ThreadDetailsPanelProps extends Pick<
  ComponentProps<typeof ThreadDetailsCard>,
  "anchor" | "handle" | "onPresentationChange"
> {
  forceNewWorktree?: boolean;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  projectId: ProjectId;
  worktreePath: string | null;
  isServerThread: boolean;
  draftId?: DraftId;
  activeProjectName: string | undefined;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  showOpenInPicker: boolean;
  openInShortcutEnabled: boolean;
  gitCwd: string | null;
  isGitRepo: boolean;
  envLocked: boolean;
  availableEnvironments: readonly EnvironmentOption[];
  autoEnvironmentLabel?: string | undefined;
  onAutoEnvironment?: (() => void) | undefined;
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
  onEnvModeChange: (mode: EnvMode) => void;
  envMode: EnvMode;
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (branch: string | null) => void;
  startFromOrigin: boolean;
  onStartFromOriginChange: (startFromOrigin: boolean) => void;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest: () => void;
  onOpenChanges?: () => void;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
  contextWindow: ContextWindowSnapshot | null;
  onCompactContext?: (() => void) | undefined;
  compactDisabled: boolean;
  compactDisabledReason: string | null;
  mcpServers: ReadonlyArray<OrchestrationV2McpServerStatus>;
  outputs: ReadonlyArray<ThreadOutput>;
  workspaceRoot: string | null;
  onOpenFile: (relativePath: string) => void;
}

export function ThreadDetailsPanel(props: ThreadDetailsPanelProps) {
  const repositories = useThreadRepositories(
    props.activeProjectName !== undefined && props.workspaceRoot !== null
      ? {
          environmentId: props.environmentId,
          projectId: props.projectId,
          threadId: props.threadId,
          projectName: props.activeProjectName,
          workspaceRoot: props.workspaceRoot,
          worktreePath: props.worktreePath,
          envMode: props.forceNewWorktree ? "worktree" : props.envMode,
        }
      : null,
  );
  const repositoryCwd = repositories.repositoryCwd;
  const isGitActionRunning = useSourceControlActionRunning(
    { environmentId: props.environmentId, cwd: repositoryCwd ?? props.gitCwd },
    RUNNING_SOURCE_CONTROL_ACTIONS,
  );
  const fileScripts = useT3ProjectFileScripts(
    props.environmentId,
    props.activeProjectScripts ? props.gitCwd : null,
  );
  const activeThreadRef = { environmentId: props.environmentId, threadId: props.threadId };
  const branchToolbarProps = {
    showGitControls: props.isGitRepo,
    environmentId: props.environmentId,
    threadId: props.threadId,
    projectId: props.projectId,
    worktreePath: props.worktreePath,
    repositoryCwd,
    isServerThread: props.isServerThread,
    ...(props.draftId ? { draftId: props.draftId } : {}),
    onEnvModeChange: props.onEnvModeChange,
    startFromOrigin: props.startFromOrigin,
    onStartFromOriginChange: props.onStartFromOriginChange,
    envMode: props.envMode,
    ...(props.activeThreadBranchOverride !== undefined
      ? { activeThreadBranchOverride: props.activeThreadBranchOverride }
      : {}),
    ...(props.onActiveThreadBranchOverrideChange
      ? { onActiveThreadBranchOverrideChange: props.onActiveThreadBranchOverrideChange }
      : {}),
    envLocked: props.envLocked,
    forceNewWorktree: props.forceNewWorktree ?? false,
    onComposerFocusRequest: props.onComposerFocusRequest,
    ...(props.onCheckoutPullRequestRequest
      ? { onCheckoutPullRequestRequest: props.onCheckoutPullRequestRequest }
      : {}),
  };

  return (
    <ThreadDetailsCard
      threadRef={{ environmentId: props.environmentId, threadId: props.threadId }}
      anchor={props.anchor}
      handle={props.handle}
      onPresentationChange={props.onPresentationChange}
    >
      {(density) => {
        const panels = threadDetailsPanels(density, Boolean(props.draftId));
        return (
          <>
            <ThreadDetailsSection
              headingId="thread-details-workspace-heading"
              title="Workspace"
              separated={false}
              showHeading={false}
            >
              <div className="flex flex-col">
                {density === "full" ? (
                  <BranchToolbar
                    layout="panel"
                    panelSection="workspace"
                    availableEnvironments={props.availableEnvironments}
                    {...(props.onEnvironmentChange
                      ? { onEnvironmentChange: props.onEnvironmentChange }
                      : {})}
                    autoEnvironmentLabel={props.autoEnvironmentLabel}
                    onAutoEnvironment={props.onAutoEnvironment}
                    {...branchToolbarProps}
                  />
                ) : null}

                {density !== "essential" && props.showOpenInPicker ? (
                  <OpenInPicker
                    keybindings={props.keybindings}
                    environmentId={props.environmentId}
                    availableEditors={props.availableEditors}
                    openInCwd={props.gitCwd}
                    enableShortcut={props.openInShortcutEnabled}
                    displayMode="panel"
                  />
                ) : null}

                {props.activeProjectScripts ? (
                  <ProjectScriptsControl
                    environmentId={props.environmentId}
                    displayMode="panel"
                    scripts={props.activeProjectScripts}
                    fileScripts={fileScripts}
                    preferredScriptId={props.preferredScriptId}
                    onRunScript={props.onRunProjectScript}
                    onAddScript={props.onAddProjectScript}
                    onUpdateScript={props.onUpdateProjectScript}
                    onDeleteScript={props.onDeleteProjectScript}
                  />
                ) : null}
              </div>
            </ThreadDetailsSection>

            {props.gitCwd ? (
              <ThreadDetailsSection
                headingId="thread-details-version-control-heading"
                title="Version Control"
                showHeading={false}
                separated={density === "full"}
              >
                <div className="flex flex-col">
                  <ThreadRepositorySelect
                    options={repositories.options}
                    selected={repositories.selected}
                    onSelect={repositories.select}
                    disabled={isGitActionRunning}
                  />
                  {props.isGitRepo || repositoryCwd !== null ? (
                    <BranchToolbar layout="panel" panelSection="branch" {...branchToolbarProps} />
                  ) : null}
                  {props.activeProjectName ? (
                    <GitActionsControl
                      displayMode="panel"
                      compact={density !== "full"}
                      gitCwd={repositoryCwd ?? props.gitCwd}
                      activeThreadRef={activeThreadRef}
                      {...(props.draftId ? { draftId: props.draftId } : {})}
                      {...(props.onOpenChanges ? { onOpenChanges: props.onOpenChanges } : {})}
                    />
                  ) : null}
                </div>
              </ThreadDetailsSection>
            ) : null}

            {panels.context ? (
              <ThreadContextPanel
                usage={props.contextWindow}
                onCompact={props.onCompactContext}
                compactDisabled={props.compactDisabled}
                compactDisabledReason={props.compactDisabledReason}
              />
            ) : null}

            {panels.connectors ? <ThreadConnectorsPanel servers={props.mcpServers} /> : null}

            {panels.outputs ? (
              <ThreadOutputsPanel
                outputs={props.outputs}
                workspaceRoot={props.workspaceRoot}
                onOpenFile={props.onOpenFile}
              />
            ) : null}

            {panels.memory ? (
              <ThreadProjectMemoryPanel
                environmentId={props.environmentId}
                projectId={props.activeProjectName === undefined ? null : props.projectId}
              />
            ) : null}

            {panels.automations ? (
              <ThreadAutomationsPanel
                environmentId={props.environmentId}
                threadId={props.threadId}
              />
            ) : null}

            {panels.mergeQueue ? (
              <ThreadMergeQueuePanel
                environmentId={props.environmentId}
                threadId={props.threadId}
              />
            ) : null}

            {panels.team ? (
              <ThreadTeamPanel environmentId={props.environmentId} threadId={props.threadId} />
            ) : null}

            {panels.relationships ? (
              <ThreadRelationshipsPanel
                environmentId={props.environmentId}
                threadId={props.threadId}
              />
            ) : null}
          </>
        );
      }}
    </ThreadDetailsCard>
  );
}
