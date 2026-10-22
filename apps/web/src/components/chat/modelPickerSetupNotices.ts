import type { ProviderInstanceId } from "@t3tools/contracts";

import type { ProviderInstanceEntry } from "../../providerInstances";

export type ModelPickerSetupNoticeVariant = "full" | "compact";

type SetupEntry = Pick<ProviderInstanceEntry, "instanceId" | "displayName" | "installed"> & {
  readonly snapshot: { readonly auth: { readonly status: string } };
};

/**
 * Pick the instances whose setup notice the picker shows.
 * Favorites lists every instance that needs setup as a short line beside the favorite models.
 */
export function resolveModelPickerSetupNotices<T extends SetupEntry>(input: {
  readonly entries: ReadonlyArray<T>;
  readonly needsSetup: (entry: T) => boolean;
  readonly selectedInstanceId: ProviderInstanceId | "favorites";
  readonly selectedInstanceKnown: boolean;
  readonly filteredModelCount: number;
}): { readonly entries: ReadonlyArray<T>; readonly variant: ModelPickerSetupNoticeVariant } {
  const candidates = input.entries.filter(input.needsSetup);
  if (input.selectedInstanceId === "favorites") {
    return { entries: candidates, variant: "compact" };
  }
  return {
    entries: candidates.filter((entry) =>
      input.selectedInstanceKnown
        ? entry.instanceId === input.selectedInstanceId
        : input.filteredModelCount === 0,
    ),
    variant: "full",
  };
}

/** Name the instance and why it cannot list models yet. */
export function modelPickerSetupSummary(entry: SetupEntry): string {
  if (!entry.installed) return `${entry.displayName} is not installed`;
  if (entry.snapshot.auth.status === "unauthenticated") {
    return `${entry.displayName} is not signed in`;
  }
  return `${entry.displayName} needs setup`;
}
