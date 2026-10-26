import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useRepositorySelectionStore } from "./repositorySelectionStore";

const ref = scopeThreadRef(EnvironmentId.make("env"), ThreadId.make("thread"));

describe("repositorySelectionStore", () => {
  beforeEach(() => {
    useRepositorySelectionStore.setState({ byThreadKey: {} });
  });

  it("remembers a nested choice and an explicit outer choice per thread", () => {
    useRepositorySelectionStore.getState().select(ref, "backend");
    expect(Object.values(useRepositorySelectionStore.getState().byThreadKey)).toEqual(["backend"]);
    useRepositorySelectionStore.getState().select(ref, null);
    expect(Object.values(useRepositorySelectionStore.getState().byThreadKey)).toEqual([null]);
  });

  it("forgets a removed thread", () => {
    useRepositorySelectionStore.getState().select(ref, "backend");
    useRepositorySelectionStore.getState().removeThread(ref);
    expect(useRepositorySelectionStore.getState().byThreadKey).toEqual({});
  });
});
