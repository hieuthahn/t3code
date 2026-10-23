export interface DesktopSession {
  readonly localId: string;
  readonly orgId: string;
  readonly cliSessionId: string;
  readonly priorCliSessionIds: ReadonlyArray<string>;
  readonly cwd: string;
  readonly title: string;
  readonly isArchived: boolean;
  readonly deleted: boolean;
  readonly scratch: boolean;
  readonly hasTranscript: boolean;
  readonly lastActivityAt: number;
  readonly createdAt: number;
}

export interface T3Thread {
  readonly threadId: string;
  readonly projectId: string;
  readonly workspaceRoot: string;
  readonly title: string;
  readonly archived: boolean;
  readonly deleted: boolean;
  readonly running: boolean;
  readonly claudeSessionIds: ReadonlyArray<string>;
  readonly hasTranscript: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SyncLink {
  readonly desktopLocalId: string;
  readonly t3ThreadId: string;
  readonly sessionIds: ReadonlyArray<string>;
  readonly desktop: { readonly title: string; readonly isArchived: boolean };
  readonly t3: { readonly title: string; readonly archived: boolean };
  readonly syncedAt: number;
}

export type SyncItem =
  | { readonly kind: "importToT3"; readonly id: string; readonly desktop: DesktopSession }
  | {
      readonly kind: "createInDesktop";
      readonly id: string;
      readonly thread: T3Thread;
      readonly sessionId: string;
    }
  | {
      readonly kind: "renameT3" | "renameDesktop";
      readonly id: string;
      readonly pair: SyncPair;
      readonly title: string;
    }
  | {
      readonly kind: "archiveT3" | "archiveDesktop";
      readonly id: string;
      readonly pair: SyncPair;
      readonly archived: boolean;
    }
  | {
      readonly kind: "suggestArchiveT3" | "suggestArchiveDesktop";
      readonly id: string;
      readonly pair: SyncPair;
    }
  | {
      readonly kind: "conflict";
      readonly id: string;
      readonly pair: SyncPair;
      readonly field: "title" | "archived";
    }
  | { readonly kind: "skip"; readonly id: string; readonly label: string; readonly reason: string };

export interface SyncPair {
  readonly desktop: DesktopSession;
  readonly thread: T3Thread;
}

export interface SyncPlan {
  readonly items: ReadonlyArray<SyncItem>;
  readonly pairs: ReadonlyArray<SyncPair>;
}

export interface PlanInput {
  readonly desktop: ReadonlyArray<DesktopSession>;
  readonly threads: ReadonlyArray<T3Thread>;
  readonly links: ReadonlyArray<SyncLink>;
  readonly now: number;
  readonly forkParentOf: (cliSessionId: string) => string | null;
}

const ACTIVE_IN_DESKTOP_MS = 2 * 60 * 1000;

export function sessionKeys(session: DesktopSession): ReadonlyArray<string> {
  return [session.cliSessionId, ...session.priorCliSessionIds];
}

/** Return the actions that bring Claude Desktop sessions and T3 threads in line, without touching either side. */
export function planSync(input: PlanInput): SyncPlan {
  const threadsBySession = new Map<string, T3Thread[]>();
  for (const thread of input.threads) {
    for (const sessionId of thread.claudeSessionIds) {
      const list = threadsBySession.get(sessionId) ?? [];
      if (!list.includes(thread)) list.push(thread);
      threadsBySession.set(sessionId, list);
    }
  }
  const linksByDesktop = new Map(input.links.map((link) => [link.desktopLocalId, link]));
  const threadsById = new Map(input.threads.map((thread) => [thread.threadId, thread]));
  const desktopByThread = new Map<string, DesktopSession[]>();
  const candidates = new Map<string, T3Thread[]>();
  for (const session of input.desktop) {
    const linked = linksByDesktop.get(session.localId);
    const linkedThread = linked === undefined ? undefined : threadsById.get(linked.t3ThreadId);
    const matched =
      linkedThread !== undefined
        ? [linkedThread]
        : [...new Set(sessionKeys(session).flatMap((key) => threadsBySession.get(key) ?? []))];
    candidates.set(session.localId, matched);
    for (const thread of matched) {
      desktopByThread.set(thread.threadId, [
        ...(desktopByThread.get(thread.threadId) ?? []),
        session,
      ]);
    }
  }

  const items: SyncItem[] = [];
  const pairs: SyncPair[] = [];
  const pairedThreads = new Set<string>();
  for (const session of input.desktop) {
    const matched = candidates.get(session.localId) ?? [];
    const label = session.title;
    if (matched.length > 1) {
      matched.forEach((thread) => pairedThreads.add(thread.threadId));
      items.push(skip(session.localId, label, `matches ${matched.length} T3 threads`));
      continue;
    }
    const thread = matched[0];
    if (thread === undefined) {
      items.push(...unmatchedDesktop(session, input, threadsBySession));
      continue;
    }
    pairedThreads.add(thread.threadId);
    if ((desktopByThread.get(thread.threadId) ?? []).length > 1) {
      items.push(
        skip(session.localId, label, "another Claude Desktop session matches the same T3 thread"),
      );
      continue;
    }
    const pair = { desktop: session, thread };
    pairs.push(pair);
    items.push(...pairActions(pair, linksByDesktop.get(session.localId), input.now));
  }
  for (const thread of input.threads) {
    if (pairedThreads.has(thread.threadId)) continue;
    items.push(...unmatchedThread(thread));
  }
  return { items, pairs };
}

function skip(id: string, label: string, reason: string): SyncItem {
  return { kind: "skip", id: `skip:${id}`, label, reason };
}

function unmatchedDesktop(
  session: DesktopSession,
  input: PlanInput,
  threadsBySession: ReadonlyMap<string, ReadonlyArray<T3Thread>>,
): ReadonlyArray<SyncItem> {
  if (session.deleted || session.isArchived) return [];
  if (!session.hasTranscript)
    return [skip(session.localId, session.title, "no transcript on disk")];
  if (input.now - session.lastActivityAt < ACTIVE_IN_DESKTOP_MS) {
    return [skip(session.localId, session.title, "active in Claude Desktop")];
  }
  const parent = input.forkParentOf(session.cliSessionId);
  if (parent !== null && (threadsBySession.get(parent)?.length ?? 0) > 0) {
    return [skip(session.localId, session.title, "fork of a session T3 already has")];
  }
  return [{ kind: "importToT3", id: `import:${session.localId}`, desktop: session }];
}

function unmatchedThread(thread: T3Thread): ReadonlyArray<SyncItem> {
  if (thread.deleted || thread.archived) return [];
  const sessionId = thread.claudeSessionIds.at(-1);
  if (sessionId === undefined) return [skip(thread.threadId, thread.title, "not a Claude thread")];
  if (thread.workspaceRoot.includes("/scratch-workspaces/")) {
    return [skip(thread.threadId, thread.title, "scratch workspace")];
  }
  if (!thread.hasTranscript) return [skip(thread.threadId, thread.title, "no transcript on disk")];
  if (thread.running) return [skip(thread.threadId, thread.title, "running in T3")];
  return [{ kind: "createInDesktop", id: `create:${thread.threadId}`, thread, sessionId }];
}

function pairActions(
  pair: SyncPair,
  link: SyncLink | undefined,
  now: number,
): ReadonlyArray<SyncItem> {
  const { desktop, thread } = pair;
  const key = desktop.localId;
  if (thread.running || now - desktop.lastActivityAt < ACTIVE_IN_DESKTOP_MS) {
    return [
      skip(key, desktop.title, thread.running ? "running in T3" : "active in Claude Desktop"),
    ];
  }
  if (desktop.deleted && !thread.deleted) {
    return thread.archived ? [] : [{ kind: "suggestArchiveT3", id: `suggest-t3:${key}`, pair }];
  }
  if (thread.deleted && !desktop.deleted) {
    return desktop.isArchived
      ? []
      : [{ kind: "suggestArchiveDesktop", id: `suggest-desktop:${key}`, pair }];
  }
  if (desktop.deleted) return [];
  const items: SyncItem[] = [];
  const title = resolve(desktop.title, thread.title, link?.desktop.title, link?.t3.title);
  if (title === "desktop")
    items.push({ kind: "renameT3", id: `rename-t3:${key}`, pair, title: desktop.title });
  if (title === "t3")
    items.push({ kind: "renameDesktop", id: `rename-desktop:${key}`, pair, title: thread.title });
  if (title === "conflict")
    items.push({ kind: "conflict", id: `conflict-title:${key}`, pair, field: "title" });
  const archived = resolve(
    desktop.isArchived,
    thread.archived,
    link?.desktop.isArchived,
    link?.t3.archived,
  );
  if (archived === "desktop") {
    items.push({ kind: "archiveT3", id: `archive-t3:${key}`, pair, archived: desktop.isArchived });
  }
  if (archived === "t3") {
    items.push({
      kind: "archiveDesktop",
      id: `archive-desktop:${key}`,
      pair,
      archived: thread.archived,
    });
  }
  if (archived === "conflict")
    items.push({ kind: "conflict", id: `conflict-archived:${key}`, pair, field: "archived" });
  return items;
}

/** Say which side's value should win, judged against what both sides held at the last sync. */
function resolve<A>(desktop: A, t3: A, lastDesktop: A | undefined, lastT3: A | undefined) {
  if (desktop === t3) return "same" as const;
  if (lastDesktop === undefined || lastT3 === undefined) return "conflict" as const;
  const desktopChanged = desktop !== lastDesktop;
  const t3Changed = t3 !== lastT3;
  if (desktopChanged && !t3Changed) return "desktop" as const;
  if (t3Changed && !desktopChanged) return "t3" as const;
  return "conflict" as const;
}
