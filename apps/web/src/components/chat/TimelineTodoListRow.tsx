import type { OrchestrationV2PlanStep } from "@t3tools/contracts";
import { CheckIcon, CircleDotIcon, CircleIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import type { TimelineRow } from "./timelineRowContext";

const stepStatusLabels = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
} satisfies Record<OrchestrationV2PlanStep["status"], string>;

function StepIcon({ status }: { readonly status: OrchestrationV2PlanStep["status"] }) {
  if (status === "completed") return <CheckIcon className="size-3.5 text-success" aria-hidden />;
  if (status === "running") return <CircleDotIcon className="size-3.5 text-primary" aria-hidden />;
  return <CircleIcon className="size-3.5 text-muted-foreground/40" aria-hidden />;
}

export function TodoListTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "todo-list" }> }) {
  const completed = row.steps.filter((step) => step.status === "completed").length;
  return (
    <section
      aria-label={`To-do, ${completed} of ${row.steps.length} complete`}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/60 bg-card p-3"
      data-timeline-todo-list="true"
    >
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <h3 className="font-medium text-foreground">To-do</h3>
        <span className="text-xs text-muted-foreground tabular-nums" data-timeline-todo-progress>
          {completed} of {row.steps.length}
        </span>
      </div>
      <ul className="flex min-w-0 flex-col gap-1.5">
        {row.steps.map((step) => (
          <li key={step.id} className="flex min-w-0 items-start gap-2 text-sm">
            <span className="mt-0.5 shrink-0">
              <StepIcon status={step.status} />
            </span>
            <span
              className={cn(
                "min-w-0 wrap-anywhere",
                step.status === "completed"
                  ? "text-muted-foreground/60"
                  : step.status === "running"
                    ? "text-foreground"
                    : "text-foreground/80",
              )}
            >
              <span className="sr-only">{stepStatusLabels[step.status]}: </span>
              {step.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
