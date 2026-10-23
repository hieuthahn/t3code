import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const claudeDesktopSyncRun = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:claude-desktop-sync:run",
  tag: WS_METHODS.claudeDesktopSyncRun,
});
