import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import type * as ProjectService from "../project/ProjectService.ts";
import { transcriptIds } from "./ClaudeDesktopStore.ts";
import type { T3Thread } from "./ClaudeDesktopSyncPlan.ts";

/** Read every T3 thread, active and archived, with the Claude session ids it ran. */
export const readT3Threads = Effect.fn("readT3Threads")(function* (
  orchestrator: Orchestrator.OrchestratorV2["Service"],
  projects: ProjectService.ProjectService["Service"],
  transcriptsRoot: string,
) {
  const transcripts = yield* transcriptIds(transcriptsRoot);
  const snapshot = yield* projects.snapshot;
  const workspaceRoots = new Map(
    snapshot.projects.map((project) => [project.id as string, project.workspaceRoot]),
  );
  const active = yield* orchestrator.getShellSnapshot({ location: "active" });
  const archived = yield* orchestrator.getShellSnapshot({ location: "archive" });
  const shells = [
    ...active.threads,
    ...active.archivedThreads,
    ...archived.threads,
    ...archived.archivedThreads,
  ];
  const seen = new Set<string>();
  const threads: T3Thread[] = [];
  for (const shell of shells) {
    if (seen.has(shell.id)) continue;
    seen.add(shell.id);
    const records = yield* orchestrator
      .getThreadRecords(shell.id, ["providerThreads"])
      .pipe(Effect.option);
    const claudeSessionIds = Option.match(records, {
      onNone: () => [],
      onSome: (value) =>
        value.providerThreads
          .filter((provider) => provider.driver === "claudeAgent")
          .flatMap((provider) =>
            provider.nativeThreadRef?.nativeId ? [provider.nativeThreadRef.nativeId] : [],
          ),
    });
    threads.push({
      threadId: shell.id,
      projectId: shell.projectId,
      workspaceRoot: workspaceRoots.get(shell.projectId) ?? "",
      title: shell.title,
      archived: shell.archivedAt !== null,
      deleted: shell.deletedAt !== null,
      running: shell.activeRunId !== null,
      claudeSessionIds,
      hasTranscript: claudeSessionIds.some((id) => transcripts.has(id)),
      createdAt: DateTime.toEpochMillis(shell.createdAt),
      updatedAt: DateTime.toEpochMillis(shell.updatedAt),
    });
  }
  return threads;
});
