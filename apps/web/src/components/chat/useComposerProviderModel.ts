import {
  type DraftId,
  deriveEffectiveComposerModelState,
  useComposerDraftModelState,
} from "../../composerDraftStore";
import {
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  ProviderDriverKind,
  type ScopedThreadRef,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  NO_PROVIDER_MODEL_SELECTION,
  type ProviderInstanceEntry,
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { type UnifiedSettings } from "@t3tools/contracts/settings";
import { getComposerPromptInjectionState, getComposerProviderState } from "./composerProviderState";
import { resolveComposerProviderSelection } from "../ChatView.logic";
import { useDefaultAccountByDriver, useModelPickerMergeAccounts } from "../../hooks/useSettings";
import { resolveDefaultAccountInstance } from "./modelPickerAccountGroups";

const NO_PROVIDER_MODELS: ServerProvider["models"] = [];

/**
 * The provider instances the composer offers, which one is selected, and the model and options
 * the draft resolves to on it. The draft store is read first so every derivation follows the only
 * hook here; in the composer body they would straddle its later hooks and lose their cache.
 */
export function useComposerProviderModel(
  input: Omit<Parameters<typeof resolveComposerProviderSelection>[0], "entries"> & {
    readonly providerStatuses: ReadonlyArray<ServerProvider>;
    readonly settings: UnifiedSettings;
    readonly activeProjectId: ProjectId | null;
    readonly environmentId: EnvironmentId;
    readonly threadStarted: boolean;
    readonly threadRef: ScopedThreadRef | DraftId;
    readonly threadModelSelection: ModelSelection | null | undefined;
    readonly projectModelSelection: ModelSelection | null | undefined;
    readonly promptInjectionState: ReturnType<typeof getComposerPromptInjectionState>;
  },
) {
  const {
    providerStatuses,
    settings,
    activeProjectId,
    environmentId,
    threadStarted,
    threadRef,
    threadModelSelection,
    projectModelSelection,
    promptInjectionState,
    candidateInstanceIds,
    lockedProvider,
    lockedInstanceId,
  } = input;
  const draftModelState = useComposerDraftModelState(threadRef);
  const providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry> = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providerStatuses),
      settings,
      activeProjectId,
    ),
  );
  const selection = resolveComposerProviderSelection({
    entries: providerInstanceEntries,
    candidateInstanceIds,
    lockedProvider,
    lockedInstanceId,
  });
  const defaultAccountByDriver = useDefaultAccountByDriver(environmentId);
  const mergeAccounts = useModelPickerMergeAccounts(environmentId);
  const defaultAccountEntry = resolveDefaultAccountInstance({
    entries: providerInstanceEntries,
    selected: selection.selectedProviderEntry,
    defaults: defaultAccountByDriver,
    mergeAccounts,
    keepOwnAccount: threadStarted || draftModelState.modelSelectionExplicit === true,
  });
  const selectedProviderEntry = defaultAccountEntry ?? selection.selectedProviderEntry;
  const selectedInstanceId =
    selectedProviderEntry?.instanceId ?? NO_PROVIDER_MODEL_SELECTION.instanceId;
  const selectedProvider: ProviderDriverKind =
    selectedProviderEntry?.driverKind ?? selection.requestedDriverKind;
  const modelState = deriveEffectiveComposerModelState({
    draft: draftModelState,
    providers: providerStatuses,
    selectedProvider,
    selectedInstanceId,
    threadModelSelection,
    projectModelSelection,
    settings,
  });
  const selectedProviderModels = selectedProviderEntry?.models ?? NO_PROVIDER_MODELS;
  const composerProviderState = getComposerProviderState({
    provider: selectedProvider,
    model: modelState.selectedModel,
    models: selectedProviderModels,
    promptInjectionState,
    modelOptions: modelState.modelOptions?.[selectedInstanceId],
    planModeEnabled: settings.planModeEnabled,
  });
  return {
    providerInstanceEntries,
    ...selection,
    selectedProviderEntry,
    defaultAccountPinned: defaultAccountEntry !== null,
    selectedInstanceId,
    selectedProvider,
    selectedProviderModels,
    composerModelOptions: modelState.modelOptions,
    selectedModel: modelState.selectedModel,
    composerProviderState,
  };
}
