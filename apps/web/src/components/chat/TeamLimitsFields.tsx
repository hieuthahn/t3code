import { TEAM_LIMIT_BOUNDS, type TeamLimits, type TeamUsage } from "@t3tools/contracts";

import { Checkbox } from "../ui/checkbox";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";

function LimitField(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[1fr_8rem] items-center gap-2 text-sm">
      {props.label}
      <NumberField
        size="sm"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        format={{ useGrouping: false }}
        disabled={props.disabled}
        onValueChange={(next) => {
          if (next !== null) props.onChange(next);
        }}
      >
        <NumberFieldGroup>
          <NumberFieldDecrement />
          <NumberFieldInput aria-label={props.label} />
          <NumberFieldIncrement />
        </NumberFieldGroup>
      </NumberField>
    </label>
  );
}

/** Run limits; a running team cannot drop a limit below what it already used. */
export function TeamLimitsFields(props: {
  readonly limits: TeamLimits;
  readonly used: TeamUsage;
  readonly disabled: boolean;
  readonly onChange: (limits: TeamLimits) => void;
}) {
  const { limits } = props;
  const set = (patch: Partial<TeamLimits>) => props.onChange({ ...limits, ...patch });
  return (
    <div className="grid gap-2">
      <LimitField
        label="Review rounds"
        value={limits.maxRounds}
        min={Math.max(TEAM_LIMIT_BOUNDS.maxRounds.minimum, props.used.rounds)}
        max={TEAM_LIMIT_BOUNDS.maxRounds.maximum}
        disabled={props.disabled}
        onChange={(maxRounds) => set({ maxRounds })}
      />
      <LimitField
        label="Assignments"
        value={limits.maxAssignments}
        min={Math.max(TEAM_LIMIT_BOUNDS.maxAssignments.minimum, props.used.assignments)}
        max={TEAM_LIMIT_BOUNDS.maxAssignments.maximum}
        disabled={props.disabled}
        onChange={(maxAssignments) => set({ maxAssignments })}
      />
      <div className="grid grid-cols-[1fr_auto_8rem] items-center gap-2 text-sm">
        <span>At once</span>
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox
            checked={limits.maxParallel === "unlimited"}
            disabled={props.disabled}
            onCheckedChange={(checked) => set({ maxParallel: checked ? "unlimited" : 2 })}
          />
          Unlimited
        </label>
        <NumberField
          size="sm"
          value={limits.maxParallel === "unlimited" ? null : limits.maxParallel}
          min={1}
          max={50}
          format={{ useGrouping: false }}
          disabled={props.disabled || limits.maxParallel === "unlimited"}
          onValueChange={(next) => {
            if (next !== null) set({ maxParallel: next });
          }}
        >
          <NumberFieldGroup>
            <NumberFieldDecrement />
            <NumberFieldInput aria-label="At once" />
            <NumberFieldIncrement />
          </NumberFieldGroup>
        </NumberField>
      </div>
      <LimitField
        label="Report size (bytes)"
        value={limits.summaryLimitBytes}
        min={TEAM_LIMIT_BOUNDS.summaryLimitBytes.minimum}
        max={TEAM_LIMIT_BOUNDS.summaryLimitBytes.maximum}
        step={256}
        disabled={props.disabled}
        onChange={(summaryLimitBytes) => set({ summaryLimitBytes })}
      />
      <p className="text-muted-foreground text-xs">
        Each provider account runs at most 2 workers at once.
      </p>
    </div>
  );
}
