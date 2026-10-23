import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Link, useRouter, useSearch } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  CircleStopIcon,
  ExternalLinkIcon,
} from "lucide-react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { useEscapeToGoBack } from "../../hooks/useNavigateBack";
import { useNowSecond } from "../../hooks/useNowSecond";
import { useProject, useThreadShell, useThreadStatus } from "../../state/entities";
import { environmentThreadDetails } from "../../state/threads";
import { buildThreadRouteParams } from "../../threadRoutes";
import ChatMarkdown from "../ChatMarkdown";
import { sidebarProviderEntriesAtom } from "../sidebar/sidebarProviderEntries";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  compareModelLabel,
  type CompareRunTone,
  describeCompareRun,
  type LatestReply,
  latestReply,
  parseCompareThreads,
  sharedPrompt,
} from "./fanoutCompare.logic";

const NO_REPLIES: readonly LatestReply[] = [];

const compareRepliesAtom = Atom.family((threads: string) =>
  Atom.make((get) => {
    const refs = parseCompareThreads(threads);
    return refs === null
      ? NO_REPLIES
      : refs.map((ref) => latestReply(get(environmentThreadDetails.visibleTurnItemsAtom(ref))));
  }).pipe(Atom.setIdleTTL(0), Atom.withLabel(`fanout-compare-replies:${threads}`)),
);

const TONE_CLASS: Record<CompareRunTone, string> = {
  working: "text-info",
  done: "text-success",
  failed: "text-error",
  stopped: "text-muted-foreground",
  idle: "text-muted-foreground",
};

function RunToneIcon({ tone }: { tone: CompareRunTone }) {
  switch (tone) {
    case "working":
      return <CircleDashedIcon aria-hidden className="size-3.5 shrink-0" />;
    case "done":
      return <CircleCheckIcon aria-hidden className="size-3.5 shrink-0" />;
    case "failed":
      return <CircleAlertIcon aria-hidden className="size-3.5 shrink-0" />;
    case "stopped":
      return <CircleStopIcon aria-hidden className="size-3.5 shrink-0" />;
    case "idle":
      return <CircleIcon aria-hidden className="size-3.5 shrink-0" />;
  }
}

function CompareColumn(props: {
  threadRef: ScopedThreadRef;
  reply: LatestReply;
  showPrompt: boolean;
  nowMs: number;
}) {
  const { threadRef, reply } = props;
  const router = useRouter();
  const shell = useThreadShell(threadRef);
  const syncStatus = useThreadStatus(threadRef);
  const project = useProject(shell ? scopeProjectRef(shell.environmentId, shell.projectId) : null);
  const providerEntries = useAtomValue(sidebarProviderEntriesAtom);
  if (shell === null || syncStatus === "deleted") {
    return (
      <section className="flex min-h-0 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm font-medium text-foreground">Thread not found</p>
        <p className="text-sm text-muted-foreground">It was deleted or archived.</p>
      </section>
    );
  }
  const modelLabel = compareModelLabel(
    providerEntries
      .get(shell.environmentId)
      ?.get(shell.runtime?.providerInstanceId ?? shell.modelSelection.instanceId),
    shell.modelSelection.model,
  );
  const run = describeCompareRun(shell.latestRun, props.nowMs);
  const loading =
    reply.reply === null && (syncStatus === "empty" || syncStatus === "synchronizing");
  return (
    <section aria-label={modelLabel} className="flex min-h-0 min-w-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {modelLabel}
        </h2>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 text-xs font-medium",
            TONE_CLASS[run.tone],
          )}
        >
          <RunToneIcon tone={run.tone} />
          <span role="status">{run.label}</span>
        </span>
        {run.durationMs === null ? null : (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatWorkingDurationLabel(run.durationMs)}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Open the ${modelLabel} thread`}
          onClick={() =>
            void router.navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(threadRef),
            })
          }
        >
          <ExternalLinkIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-10">
        {props.showPrompt && reply.prompt !== null ? (
          <p className="mb-4 line-clamp-4 border-b border-border pb-4 text-sm whitespace-pre-wrap text-muted-foreground">
            {reply.prompt}
          </p>
        ) : null}
        {reply.reply !== null ? (
          <ChatMarkdown
            text={reply.reply}
            cwd={shell.worktreePath ?? project?.workspaceRoot}
            threadRef={threadRef}
            environmentId={threadRef.environmentId}
            isStreaming={reply.streaming}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading the reply…" : "No reply yet."}
          </p>
        )}
      </div>
    </section>
  );
}

export function FanoutComparePage() {
  useEscapeToGoBack();
  const { threads } = useSearch({ from: "/_chat/compare" });
  const refs = parseCompareThreads(threads);
  const replies = useAtomValue(compareRepliesAtom(threads ?? ""));
  const nowMs = useNowSecond();
  const firstShell = useThreadShell(refs?.[0] ?? null);
  const prompt = sharedPrompt(replies.map((reply) => reply.prompt));
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="bg-background">
          <WorkspaceBreadcrumb ariaLabel="Compare breadcrumb" className="overflow-hidden">
            <WorkspaceBreadcrumbItem>Compare</WorkspaceBreadcrumbItem>
            {firstShell === null ? null : (
              <>
                <WorkspaceBreadcrumbSeparator />
                <WorkspaceBreadcrumbItem current className="min-w-0">
                  <h1 className="truncate">{firstShell.title}</h1>
                </WorkspaceBreadcrumbItem>
              </>
            )}
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>
        {refs === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium text-foreground">Nothing to compare</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Open a multiple-models group in the sidebar and choose Compare.
            </p>
            <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">
              Back to threads
            </Link>
          </div>
        ) : (
          <>
            {prompt === null ? null : (
              <div className="shrink-0 border-b border-border px-4 py-3">
                <p className="line-clamp-3 max-w-[75ch] text-sm whitespace-pre-wrap text-muted-foreground">
                  {prompt}
                </p>
              </div>
            )}
            <div
              className="grid min-h-0 flex-1 auto-cols-[minmax(20rem,1fr)] grid-flow-col divide-x divide-border overflow-x-auto"
              data-testid="fanout-compare-columns"
            >
              {refs.map((ref, index) => (
                <CompareColumn
                  key={scopedThreadKey(ref)}
                  threadRef={ref}
                  reply={replies[index] ?? { prompt: null, reply: null, streaming: false }}
                  showPrompt={prompt === null}
                  nowMs={nowMs}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </SidebarInset>
  );
}
