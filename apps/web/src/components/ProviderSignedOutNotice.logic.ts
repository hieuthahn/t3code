import type { ProviderInstanceId, ServerProvider } from "@t3tools/contracts";

/** Split providers into signed-out accounts not yet announced and announced ones signed in again. */
export function signedOutNoticeChanges(
  providers: ReadonlyArray<ServerProvider>,
  announced: ReadonlySet<string>,
): { readonly announce: ReadonlyArray<ServerProvider>; readonly forget: ReadonlyArray<string> } {
  const signedOut = providers.filter(
    (provider) =>
      provider.enabled && provider.installed && provider.auth.status === "unauthenticated",
  );
  const signedOutIds = new Set<ProviderInstanceId | string>(
    signedOut.map((provider) => provider.instanceId),
  );
  return {
    announce: signedOut.filter((provider) => !announced.has(provider.instanceId)),
    forget: [...announced].filter(
      (instanceId) =>
        !signedOutIds.has(instanceId) &&
        providers.some(
          (provider) =>
            provider.instanceId === instanceId && provider.auth.status === "authenticated",
        ),
    ),
  };
}
