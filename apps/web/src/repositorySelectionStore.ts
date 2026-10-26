import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

interface RepositorySelectionState {
  /** A null value is an explicit choice of the outer repository. */
  byThreadKey: Record<string, string | null>;
  select: (ref: ScopedThreadRef, repositoryPath: string | null) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

export const useRepositorySelectionStore = create<RepositorySelectionState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      select: (ref, repositoryPath) =>
        set((state) => ({
          byThreadKey: { ...state.byThreadKey, [scopedThreadKey(ref)]: repositoryPath },
        })),
      removeThread: (ref) =>
        set((state) => {
          const { [scopedThreadKey(ref)]: _removed, ...rest } = state.byThreadKey;
          return { byThreadKey: rest };
        }),
    }),
    {
      name: "t3code:repository-selection:v1",
      storage: createJSONStorage(() => resolveStorage(window.localStorage)),
    },
  ),
);
