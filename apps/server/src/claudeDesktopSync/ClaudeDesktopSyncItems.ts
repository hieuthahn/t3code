import type { ClaudeDesktopSyncApplyInput, ClaudeDesktopSyncItem } from "@t3tools/contracts";

import {
  sessionKeys,
  type DesktopSession,
  type SyncItem,
  type SyncLink,
  type SyncPair,
  type T3Thread,
} from "./ClaudeDesktopSyncPlan.ts";

export type DesktopOp =
  | {
      readonly opId: string;
      readonly kind: "create";
      readonly orgId: string;
      readonly sessionId: string;
      readonly cliSessionId: string;
      readonly priorCliSessionIds: ReadonlyArray<string>;
      readonly cwd: string;
      readonly title: string;
      readonly isArchived: boolean;
      readonly createdAt: number;
      readonly lastActivityAt: number;
      readonly t3ThreadId: string;
    }
  | {
      readonly opId: string;
      readonly kind: "title";
      readonly orgId: string;
      readonly sessionId: string;
      readonly title: string;
    }
  | {
      readonly opId: string;
      readonly kind: "archive";
      readonly orgId: string;
      readonly sessionId: string;
      readonly isArchived: boolean;
    };

export type UndoStep =
  | {
      readonly side: "t3";
      readonly id: string;
      readonly command: "rename";
      readonly threadId: string;
      readonly title: string;
    }
  | {
      readonly side: "t3";
      readonly id: string;
      readonly command: "archive" | "unarchive" | "delete";
      readonly threadId: string;
    }
  | { readonly side: "desktop"; readonly id: string; readonly op: DesktopOp };

export interface DesktopIntent {
  readonly title?: string;
  readonly isArchived?: boolean;
}

/** Turn a planned item into the row the sync dialog shows. */
export const describe = (item: SyncItem): ClaudeDesktopSyncItem => {
  switch (item.kind) {
    case "importToT3":
      return {
        id: item.id,
        kind: item.kind,
        title: item.desktop.title,
        detail: item.desktop.cwd,
        selectedByDefault: true,
      };
    case "createInDesktop":
      return {
        id: item.id,
        kind: item.kind,
        title: item.thread.title,
        detail: item.thread.workspaceRoot,
        selectedByDefault: true,
      };
    case "renameT3":
    case "renameDesktop":
      return {
        id: item.id,
        kind: item.kind,
        title: item.title,
        selectedByDefault: true,
        detail:
          item.kind === "renameT3"
            ? `was "${item.pair.thread.title}" in T3`
            : `was "${item.pair.desktop.title}" in Claude Desktop`,
      };
    case "archiveT3":
    case "archiveDesktop":
      return {
        id: item.id,
        kind: item.kind,
        title: item.pair.desktop.title,
        detail: item.archived ? "archive" : "unarchive",
        selectedByDefault: true,
      };
    case "suggestArchiveT3":
      return {
        id: item.id,
        kind: item.kind,
        title: item.pair.thread.title,
        detail: "deleted in Claude Desktop",
        selectedByDefault: false,
      };
    case "suggestArchiveDesktop":
      return {
        id: item.id,
        kind: item.kind,
        title: item.pair.desktop.title,
        detail: "deleted in T3",
        selectedByDefault: false,
      };
    case "conflict":
      return {
        id: item.id,
        kind: item.kind,
        title: item.pair.desktop.title,
        selectedByDefault: false,
        conflictField: item.field,
        detail: item.field === "title" ? "titles differ" : "archive states differ",
        desktopValue:
          item.field === "title" ? item.pair.desktop.title : String(item.pair.desktop.isArchived),
        t3Value:
          item.field === "title" ? item.pair.thread.title : String(item.pair.thread.archived),
      };
    case "skip":
      return {
        id: item.id,
        kind: item.kind,
        title: item.label,
        detail: item.reason,
        selectedByDefault: false,
      };
  }
};

/** Keep the selected items, turning each chosen conflict into the move its side asks for. */
export function resolveSelection(
  items: ReadonlyArray<SyncItem>,
  input: ClaudeDesktopSyncApplyInput,
): ReadonlyArray<SyncItem> {
  const selected = new Set(input.selectedIds);
  const choices = new Map(input.conflictChoices.map((choice) => [choice.id, choice.side]));
  return items.flatMap((item): SyncItem[] => {
    if (!selected.has(item.id) || item.kind === "skip") return [];
    if (item.kind !== "conflict") return [item];
    const side = choices.get(item.id);
    if (side === undefined) return [];
    const { id, pair } = item;
    if (item.field === "title") {
      return side === "desktop"
        ? [{ kind: "renameT3", id, pair, title: pair.desktop.title }]
        : [{ kind: "renameDesktop", id, pair, title: pair.thread.title }];
    }
    return side === "desktop"
      ? [{ kind: "archiveT3", id, pair, archived: pair.desktop.isArchived }]
      : [{ kind: "archiveDesktop", id, pair, archived: pair.thread.archived }];
  });
}

/** Pick the org folder most Desktop sessions live in, where new sessions go. */
export function desktopOrgId(desktop: ReadonlyArray<DesktopSession>): string | null {
  const counts = new Map<string, number>();
  for (const session of desktop) counts.set(session.orgId, (counts.get(session.orgId) ?? 0) + 1);
  return [...counts.entries()].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** Rebuild the sync baselines after a run; a pair still waiting on a decision keeps its old one. */
export function nextLinks(input: {
  readonly links: ReadonlyArray<SyncLink>;
  readonly items: ReadonlyArray<SyncItem>;
  readonly pairs: ReadonlyArray<SyncPair>;
  readonly desktopIntent: ReadonlyMap<string, DesktopIntent>;
  readonly created: ReadonlyArray<{
    readonly thread: T3Thread;
    readonly op: DesktopOp & { readonly kind: "create" };
  }>;
  readonly syncedAt: number;
}): ReadonlyArray<SyncLink> {
  const { syncedAt } = input;
  const links = new Map(input.links.map((link) => [link.desktopLocalId, link]));
  const actionable = new Set(
    input.items.flatMap((item) => ("pair" in item ? [item.pair.desktop.localId] : [])),
  );
  for (const pair of input.pairs) {
    const intent = input.desktopIntent.get(pair.desktop.localId);
    if (intent === undefined && actionable.has(pair.desktop.localId)) continue;
    links.set(pair.desktop.localId, {
      desktopLocalId: pair.desktop.localId,
      t3ThreadId: pair.thread.threadId,
      sessionIds: [...new Set([...sessionKeys(pair.desktop), ...pair.thread.claudeSessionIds])],
      desktop: {
        title: intent?.title ?? pair.desktop.title,
        isArchived: intent?.isArchived ?? pair.desktop.isArchived,
      },
      t3: { title: pair.thread.title, archived: pair.thread.archived },
      syncedAt,
    });
  }
  for (const { thread, op } of input.created) {
    links.set(op.sessionId, {
      desktopLocalId: op.sessionId,
      t3ThreadId: thread.threadId,
      sessionIds: [op.cliSessionId, ...op.priorCliSessionIds],
      desktop: { title: op.title, isArchived: false },
      t3: { title: thread.title, archived: thread.archived },
      syncedAt,
    });
  }
  return [...links.values()];
}
