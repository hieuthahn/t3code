import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useEnvironmentProviders, usePrimaryEnvironmentId } from "~/state/environments";
import { formatProviderDriverKindLabel } from "../providerModels";
import { signedOutNoticeChanges } from "./ProviderSignedOutNotice.logic";
import { toastManager } from "./ui/toast";

const STORAGE_KEY = "t3.providerSignedOutNotice.announced";

const readAnnounced = (): Set<string> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
};

const writeAnnounced = (announced: ReadonlySet<string>) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...announced]));
  } catch {}
};

export function ProviderSignedOutNotice() {
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const providersByEnvironment = useEnvironmentProviders();
  const providers = environmentId ? (providersByEnvironment.get(environmentId) ?? []) : [];

  useEffect(() => {
    if (!environmentId) return;
    const announced = readAnnounced();
    const changes = signedOutNoticeChanges(providers, announced);
    if (changes.announce.length === 0 && changes.forget.length === 0) return;
    for (const instanceId of changes.forget) announced.delete(instanceId);
    for (const provider of changes.announce) {
      announced.add(provider.instanceId);
      const name = provider.displayName?.trim() || formatProviderDriverKindLabel(provider.driver);
      const id = toastManager.add({
        type: "warning",
        title: `${name} is signed out`,
        description: "New threads skip this account until you sign in again.",
        timeout: 0,
        actionProps: {
          children: "Sign in",
          onClick: () => {
            toastManager.close(id);
            void navigate({
              to: "/settings/providers",
              search: { environmentId, instanceId: provider.instanceId },
            });
          },
        },
      });
    }
    writeAnnounced(announced);
  }, [environmentId, providers, navigate]);

  return null;
}
