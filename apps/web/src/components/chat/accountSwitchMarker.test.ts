import { ProviderInstanceId, RunId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveAccountSwitchMarker } from "./accountSwitchMarker";
import type { HandoffTimelineRun } from "./V2LifecycleRow";

const provider = (instanceId: string, displayName: string, groupKey = "claude:home:/shared") =>
  ({
    instanceId: ProviderInstanceId.make(instanceId),
    displayName,
    driver: "claudeAgent",
    continuation: { groupKey },
  }) as unknown as ServerProvider;

const run = (
  id: string,
  ordinal: number,
  instanceId: string,
  status: HandoffTimelineRun["status"] = "completed",
): HandoffTimelineRun => ({
  id: RunId.make(id),
  ordinal,
  providerInstanceId: ProviderInstanceId.make(instanceId),
  modelSelection: { instanceId: ProviderInstanceId.make(instanceId), model: "claude-opus-5-5" },
  status,
});

const providers = [
  provider("hieu", "hieu"),
  provider("dung", "dung"),
  provider("other", "other", "claude:home:/elsewhere"),
];

describe("resolveAccountSwitchMarker", () => {
  it("marks a run that moved to another account in the same group", () => {
    const runs = [run("r1", 1, "hieu", "failed"), run("r2", 2, "dung")];
    expect(resolveAccountSwitchMarker({ runId: RunId.make("r2"), runs, providers })).toEqual({
      fromLabel: "hieu",
      toLabel: "dung",
      afterFailedRun: true,
    });
  });

  it("compares against the latest executed run, skipping cancelled and queued ones", () => {
    const runs = [
      run("r1", 1, "hieu"),
      run("r2", 2, "dung", "cancelled"),
      run("r3", 3, "dung"),
      run("r4", 4, "hieu", "queued"),
    ];
    expect(resolveAccountSwitchMarker({ runId: RunId.make("r3"), runs, providers })).toEqual({
      fromLabel: "hieu",
      toLabel: "dung",
      afterFailedRun: false,
    });
  });

  it("marks nothing for the same account, the first run, or a move across groups", () => {
    const runs = [run("r1", 1, "hieu"), run("r2", 2, "hieu"), run("r3", 3, "other")];
    for (const runId of ["r1", "r2", "r3"]) {
      expect(resolveAccountSwitchMarker({ runId: RunId.make(runId), runs, providers })).toBeNull();
    }
    expect(resolveAccountSwitchMarker({ runId: null, runs, providers })).toBeNull();
  });
});
