import {
  childPlanChildState,
  childPlanDecideInput,
  childPlanDisplay,
  type ChildPlanItem,
} from "@t3tools/client-runtime/child-plan";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { CheckIcon, LockIcon, MinusIcon, NetworkIcon } from "lucide-react";
import { useId, useRef, useState } from "react";

import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { WorkLogRow } from "./WorkLog";

export function ChildPlanCard(props: {
  readonly environmentId: EnvironmentId;
  readonly item: ChildPlanItem;
  readonly visibility: OrchestrationV2ProjectedTurnItem["visibility"];
}) {
  const { item } = props;
  const display = childPlanDisplay(item, props.visibility);
  if (display.kind === "pending") {
    return (
      <PendingChildPlanForm key={item.revision} environmentId={props.environmentId} item={item} />
    );
  }
  const Icon =
    display.kind === "pending-elsewhere"
      ? LockIcon
      : display.kind === "closed" || item.planStatus === "declined"
        ? MinusIcon
        : CheckIcon;
  const failed = item.children.flatMap((child) => {
    const state = childPlanChildState(item, child.key);
    return state.state === "failed" ? [{ title: child.title, failure: state.failure }] : [];
  });
  return (
    <WorkLogRow
      data-v2-item-type={item.type}
      icon={<Icon className="size-3.5 text-icon-muted" aria-hidden />}
      label={
        <>
          {childSessionCount(item.children.length)} · {display.label}
        </>
      }
    >
      {failed.length > 0 ? (
        <ul className="flex flex-col gap-0.5 pb-1 pl-6 text-xs text-destructive">
          {failed.map((child) => (
            <li key={child.title}>
              {child.title}: {child.failure}
            </li>
          ))}
        </ul>
      ) : null}
    </WorkLogRow>
  );
}

function childSessionCount(count: number): string {
  return count === 1 ? "1 child session" : `${count} child sessions`;
}

function PendingChildPlanForm(props: {
  readonly environmentId: EnvironmentId;
  readonly item: ChildPlanItem;
}) {
  const { item } = props;
  const headingId = useId();
  const errorId = useId();
  const decide = useOrchestrationCommand(threadEnvironment.decideChildPlan, {
    reportFailure: false,
  });
  const [picked, setPicked] = useState<ReadonlyArray<string>>(() =>
    item.children.map((child) => child.key),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two clicks can both run before a re-render; this guard is synchronous.
  const inFlight = useRef(false);

  const send = async (approvedKeys: ReadonlyArray<string>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const result = await decide({
      environmentId: props.environmentId,
      input: childPlanDecideInput(item, approvedKeys),
    }).finally(() => {
      inFlight.current = false;
      setSubmitting(false);
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not record your choice.");
    }
  };

  const toggle = (key: string, checked: boolean) =>
    setPicked((current) =>
      checked
        ? [...current.filter((candidate) => candidate !== key), key]
        : current.filter((candidate) => candidate !== key),
    );

  return (
    <section
      data-v2-item-type={item.type}
      aria-labelledby={headingId}
      aria-describedby={error === null ? undefined : errorId}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-card p-4"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h3
          id={headingId}
          className="flex items-center gap-1.5 text-sm font-medium text-foreground"
        >
          <NetworkIcon className="size-3.5 shrink-0 text-icon-muted" aria-hidden />
          Start child sessions?
        </h3>
        {item.reason?.trim() ? (
          <p className="text-sm text-muted-foreground">{item.reason}</p>
        ) : null}
      </div>
      <ul className="flex min-w-0 flex-col gap-2.5">
        {item.children.map((child) => (
          <li key={child.key}>
            <label className="flex min-w-0 cursor-pointer items-start gap-2.5">
              <Checkbox
                className="mt-0.5"
                checked={picked.includes(child.key)}
                disabled={submitting}
                onCheckedChange={(checked) => toggle(child.key, checked === true)}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm text-foreground">{child.title}</span>
                <span className="text-xs text-muted-foreground">
                  {child.modelSelection.model} ·{" "}
                  {child.isolation === "worktree" ? "own worktree" : "shared folder"}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{child.brief}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error !== null ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex min-w-0 items-center justify-end gap-2">
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          disabled={submitting}
          onClick={() => void send([])}
        >
          Decline all
        </Button>
        <Button
          type="button"
          size="xs"
          disabled={submitting || picked.length === 0}
          onClick={() => void send(picked)}
        >
          Start {childSessionCount(picked.length)}
        </Button>
      </div>
    </section>
  );
}
