import { useState } from "react";

import { Slider } from "../ui/slider";

const MIN_PERCENT = 50;
const MAX_PERCENT = 100;

function ThresholdSlider(props: {
  readonly label: string;
  readonly value: number;
  readonly disabled: boolean;
  readonly onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? props.value;
  return (
    <div className="grid grid-cols-[5.5rem_1fr_2.75rem] items-center gap-3">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      <Slider
        thumbLabel={`${props.label} threshold`}
        min={MIN_PERCENT}
        max={MAX_PERCENT}
        step={1}
        value={shown}
        disabled={props.disabled}
        onValueChange={(value) => setDraft(value)}
        onValueCommitted={(value) => {
          setDraft(null);
          if (value !== props.value) props.onCommit(value);
        }}
      />
      <span className="text-right text-xs tabular-nums">{shown}%</span>
    </div>
  );
}

/** Two sliders for the usage share at which an account counts as near its limit. */
export function AccountSwitchThresholds(props: {
  readonly sessionPercent: number;
  readonly weeklyPercent: number;
  readonly disabled: boolean;
  readonly onChange: (patch: {
    readonly sessionPercent?: number;
    readonly weeklyPercent?: number;
  }) => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      <ThresholdSlider
        label="5-hour window"
        value={props.sessionPercent}
        disabled={props.disabled}
        onCommit={(value) => props.onChange({ sessionPercent: value })}
      />
      <ThresholdSlider
        label="Weekly window"
        value={props.weeklyPercent}
        disabled={props.disabled}
        onCommit={(value) => props.onChange({ weeklyPercent: value })}
      />
    </div>
  );
}
