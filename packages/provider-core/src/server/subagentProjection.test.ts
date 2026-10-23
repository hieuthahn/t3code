import { assert, it } from "@effect/vitest";
import {
  DEFAULT_TEAM_LIMITS,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { makeSubagentChildThread } from "./subagentProjection.ts";

const now = DateTime.makeUnsafe("2026-10-24T00:00:00.000Z");
const architect: ModelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-4-1",
};
const worker: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5-codex",
};

const parentThread: OrchestrationV2AppThread = {
  createdBy: "user",
  creationSource: "web",
  id: ThreadId.make("thread:architect"),
  projectId: ProjectId.make("project:team"),
  title: "Team",
  providerInstanceId: architect.instanceId,
  modelSelection: architect,
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  pullRequests: [],
  team: { architect, workers: [worker], limits: DEFAULT_TEAM_LIMITS },
  lineage: {
    parentThreadId: null,
    relationshipToParent: null,
    rootThreadId: ThreadId.make("thread:architect"),
  },
  forkedFrom: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  lastVisitedAt: null,
  deletedAt: null,
};

it("starts a worker as a single agent even when its parent leads a team", () => {
  const child = makeSubagentChildThread({
    parentThread,
    childThreadId: ThreadId.make("thread:worker"),
    parentNodeId: NodeId.make("node:task"),
    activeProviderThreadId: null,
    providerInstanceId: worker.instanceId,
    modelSelection: worker,
    title: "Worker",
    now,
    createdBy: "agent",
    creationSource: "mcp",
  });
  assert.isFalse("team" in child);
  assert.deepEqual(child.modelSelection, worker);
  assert.equal(child.lineage.relationshipToParent, "subagent");
});
