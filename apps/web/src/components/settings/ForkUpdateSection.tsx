import {
  type DesktopForkUpdateState,
  type DesktopForkUpdateTrack,
  type DesktopForkUpdatesBridge,
  isForkUpdateAvailable,
} from "@t3tools/contracts";
import { type ReactNode, useEffect, useState } from "react";

import { APP_VERSION } from "../../branding";
import { ensureLocalApi } from "../../localApi";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const POLL_WHILE_APPLYING_MS = 5_000;

const TRACK_LABELS: Readonly<Record<DesktopForkUpdateTrack | "paused", string>> = {
  preview: "Preview releases",
  stable: "Stable releases",
  nightly: "Nightly builds",
  paused: "Paused",
};

const formatTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

const listFiles = (files: ReadonlyArray<string>) =>
  files.length <= 3
    ? files.join(", ")
    : `${files.slice(0, 3).join(", ")} and ${files.length - 3} more`;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** True unless the repo has moved past the commit this build carries in its `+fork.<sha>` suffix. */
export function forkBuildMatchesHead(version: string, head: string): boolean {
  const built = /\+fork\.([0-9a-f]+)$/.exec(version)?.[1];
  if (!built || !head) return true;
  return built.startsWith(head) || head.startsWith(built);
}

export function describeForkUpdateCheck(state: DesktopForkUpdateState): string {
  if (state.applyRunning) {
    return "An update is running. T3 Code quits and reopens on the new build when it finishes.";
  }
  const check = state.check;
  if (!check) return "Not checked against upstream yet.";
  const checkedAt = formatTime(check.checkedAt);
  const target = check.targetTag ?? `upstream ${check.upstreamHead}`;
  if (!isForkUpdateAvailable(check)) return `Up to date with ${target}, checked ${checkedAt}.`;
  const dropped = check.droppedCommits ?? 0;
  const parts = [
    `${target} is available: ${plural(check.newCommits, "new upstream commit")}${dropped > 0 ? `, ${plural(dropped, "commit")} of the current base left out` : ""}, checked ${checkedAt}.`,
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

const gateForTarget = (state: DesktopForkUpdateState) =>
  state.gate && state.check?.targetTag !== undefined && state.gate.target === state.check.targetTag
    ? state.gate
    : null;

export function describeForkUpdateGate(state: DesktopForkUpdateState): string | null {
  const gate = gateForTarget(state);
  if (!gate) return null;
  const summaries = (status: "warn" | "block") =>
    gate.checks
      .filter((check) => check.status === status)
      .map((check) => check.summary)
      .join(" ");
  const warnings = summaries("warn");
  if (gate.verdict === "block") {
    return `Security gate blocks this update: ${summaries("block")}${warnings ? ` Also review: ${warnings}` : ""}`;
  }
  return warnings ? `Security gate passed. Review: ${warnings}` : "Security gate passed.";
}

export function forkUpdateBlockedReason(state: DesktopForkUpdateState): string | null {
  if (state.applyRunning) return "An update is already running.";
  if (!state.check || !isForkUpdateAvailable(state.check)) {
    return "There is no newer release to update to.";
  }
  if (gateForTarget(state)?.verdict === "block") {
    return "The security gate blocks this update. Read its report, then run t3-update apply --accept-gate.";
  }
  if (state.activeRuns > 0) {
    return `${state.activeRuns} agent ${state.activeRuns === 1 ? "run is" : "runs are"} active.`;
  }
  return null;
}

function useForkUpdates(bridge: DesktopForkUpdatesBridge | undefined) {
  const [state, setState] = useState<DesktopForkUpdateState | null>(null);
  const [pending, setPending] = useState<"check" | "apply" | "track" | null>(null);

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
    kind: "check" | "apply" | "track",
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

/** About rows for a fork build: checks and applies upstream release tags through `t3-update`. */
export function ForkUpdateSection({ fallback }: { fallback: ReactNode }) {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge?.forkUpdates;
  const { state, pending, run } = useForkUpdates(bridge);

  if (!bridge || (state !== null && !state.enabled)) return fallback;

  const blockedReason = state ? forkUpdateBlockedReason(state) : "Loading update status.";
  const description = state
    ? (state.error ?? describeForkUpdateCheck(state))
    : "Loading update status.";
  const lastRun = state ? describeForkUpdateRun(state) : null;
  const gateSummary = state ? describeForkUpdateGate(state) : null;
  const trackValue = state?.paused ? "paused" : (state?.track ?? "preview");
  const repoAhead = state && !forkBuildMatchesHead(APP_VERSION, state.head);

  const confirmAndApply = async () => {
    const target = state?.check?.targetTag ?? "upstream";
    const confirmed = await ensureLocalApi()
      .dialogs.confirm(
        `Update T3 Code to ${target} now? The app rebases the fork, runs the checks, rebuilds, then quits and reopens. A failed step rolls everything back.`,
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
              {repoAhead ? ` · repo at ${state.head}` : ""}
            </code>
          </span>
        }
        description={
          <>
            {description}
            {gateSummary ? <span className="mt-1 block">{gateSummary}</span> : null}
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
            : `The 08:00 and 20:00 runs move the fork to the newest of the ${TRACK_LABELS[trackValue].toLowerCase()} when no agent run is active.`
        }
        control={
          <Select
            value={trackValue}
            onValueChange={(value) => {
              if (value === trackValue) return;
              if (value === "paused") run("track", () => bridge.setPaused(true));
              else if (value === "preview" || value === "stable" || value === "nightly") {
                run("track", () => bridge.setTrack(value));
              }
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-48"
              aria-label="Update track"
              disabled={pending !== null || state === null}
            >
              <SelectValue>{TRACK_LABELS[trackValue]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(["preview", "stable", "nightly", "paused"] as const).map((value) => (
                <SelectItem key={value} hideIndicator value={value}>
                  {TRACK_LABELS[value]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </>
  );
}
