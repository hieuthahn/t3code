import type { DesktopForkUpdateState, DesktopForkUpdatesBridge } from "@t3tools/contracts";
import { type ReactNode, useEffect, useState } from "react";

import { APP_VERSION } from "../../branding";
import { ensureLocalApi } from "../../localApi";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const POLL_WHILE_APPLYING_MS = 5_000;

const formatTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

const listFiles = (files: ReadonlyArray<string>) =>
  files.length <= 3
    ? files.join(", ")
    : `${files.slice(0, 3).join(", ")} and ${files.length - 3} more`;

export function describeForkUpdateCheck(state: DesktopForkUpdateState): string {
  if (state.applyRunning) {
    return "An update is running. T3 Code quits and reopens on the new build when it finishes.";
  }
  const check = state.check;
  if (!check) return "Not checked against upstream yet.";
  const checkedAt = formatTime(check.checkedAt);
  if (check.newCommits === 0) return `Up to date with upstream main, checked ${checkedAt}.`;
  const parts = [
    `${check.newCommits} new upstream ${check.newCommits === 1 ? "commit" : "commits"} (upstream ${check.upstreamHead}), checked ${checkedAt}.`,
  ];
  if (check.conflictFiles.length > 0) {
    parts.push(`The rebase will stop on conflicts in ${listFiles(check.conflictFiles)}.`);
  } else if (check.overlapFiles.length > 0) {
    parts.push(`Both sides changed ${listFiles(check.overlapFiles)}, without real conflicts.`);
  }
  if (check.riskyFiles.length > 0) {
    parts.push(`Upstream changed contracts or the database in ${listFiles(check.riskyFiles)}.`);
  }
  return parts.join(" ");
}

export function describeForkUpdateRun(state: DesktopForkUpdateState): string | null {
  const run = state.lastRun;
  if (!run) return null;
  const outcome = run.exitCode === 0 ? "finished" : `failed at ${run.step} (exit ${run.exitCode})`;
  const conflicts =
    run.conflictFiles.length > 0 ? ` Conflicts: ${listFiles(run.conflictFiles)}.` : "";
  return `Last run: ${run.kind} ${outcome}, ${formatTime(run.finishedAt)}. ${run.message}${conflicts}`.trim();
}

export function forkUpdateBlockedReason(state: DesktopForkUpdateState): string | null {
  if (state.applyRunning) return "An update is already running.";
  if (!state.check || state.check.newCommits === 0) return "There is nothing new upstream.";
  if (state.activeRuns > 0) {
    return `${state.activeRuns} agent ${state.activeRuns === 1 ? "run is" : "runs are"} active.`;
  }
  return null;
}

function useForkUpdates(bridge: DesktopForkUpdatesBridge | undefined) {
  const [state, setState] = useState<DesktopForkUpdateState | null>(null);
  const [pending, setPending] = useState<"check" | "apply" | "pause" | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    const load = () =>
      void bridge
        .getState()
        .then((next) => {
          if (!cancelled) setState(next);
        })
        .catch(() => undefined);
    load();
    const timer = state?.applyRunning ? window.setInterval(load, POLL_WHILE_APPLYING_MS) : null;
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [bridge, state?.applyRunning]);

  const run = (
    kind: "check" | "apply" | "pause",
    action: () => Promise<DesktopForkUpdateState>,
  ) => {
    if (pending) return;
    setPending(kind);
    void action()
      .then((next) => {
        setState(next);
        if (next.error) {
          toastManager.add(
            stackedThreadToast({ type: "error", title: "T3 Code update", description: next.error }),
          );
        }
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "T3 Code update",
            description: error instanceof Error ? error.message : "The updater did not answer.",
          }),
        );
      })
      .finally(() => setPending(null));
  };

  return { state, pending, run };
}

/** About rows for a fork build: checks and applies upstream through `t3-update`. */
export function ForkUpdateSection({ fallback }: { fallback: ReactNode }) {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge?.forkUpdates;
  const { state, pending, run } = useForkUpdates(bridge);

  if (!bridge || (state !== null && !state.enabled)) return fallback;

  const blockedReason = state ? forkUpdateBlockedReason(state) : "Loading update status.";
  const description = state
    ? (state.error ?? describeForkUpdateCheck(state))
    : "Loading update status.";
  const lastRun = state ? describeForkUpdateRun(state) : null;

  const confirmAndApply = async () => {
    const confirmed = await ensureLocalApi()
      .dialogs.confirm(
        "Update T3 Code from upstream now? The app rebases the fork, runs the checks, rebuilds, then quits and reopens. A failed step rolls everything back.",
      )
      .catch(() => false);
    if (confirmed) run("apply", bridge.apply);
  };

  return (
    <>
      <SettingsRow
        id={searchableSetting("app-version").id}
        title={
          <span className="inline-flex items-baseline gap-2">
            <span>Version</span>
            <code className="text-2xs font-medium text-muted-foreground">
              {APP_VERSION}
              {state?.head ? ` · ${state.head}` : ""}
            </code>
          </span>
        }
        description={
          <>
            {description}
            {lastRun ? <span className="mt-1 block">{lastRun}</span> : null}
          </>
        }
        control={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending !== null || state?.applyRunning === true}
              onClick={() => run("check", bridge.check)}
            >
              {pending === "check" ? "Checking…" : "Check for Updates"}
            </Button>
            <Button
              size="sm"
              disabled={pending !== null || blockedReason !== null}
              title={blockedReason ?? undefined}
              onClick={() => void confirmAndApply()}
            >
              {pending === "apply" || state?.applyRunning ? "Updating…" : "Update now"}
            </Button>
          </div>
        }
      />
      <SettingsRow
        {...searchableSetting("update-track")}
        description={
          state?.paused
            ? "Paused. The 08:00 and 20:00 runs skip; Update now still works."
            : "The 08:00 and 20:00 runs update from upstream main when no agent run is active."
        }
        control={
          <Select
            value={state?.paused ? "paused" : "follow"}
            onValueChange={(value) => {
              const paused = value === "paused";
              if (paused !== state?.paused) run("pause", () => bridge.setPaused(paused));
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-48"
              aria-label="Update track"
              disabled={pending !== null || state === null}
            >
              <SelectValue>{state?.paused ? "Paused" : "Follow upstream main"}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="follow">
                Follow upstream main
              </SelectItem>
              <SelectItem hideIndicator value="paused">
                Paused
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
    </>
  );
}
