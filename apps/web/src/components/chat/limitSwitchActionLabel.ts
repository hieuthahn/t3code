const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const formatTimeUntil = (untilMs: number): string => {
  if (untilMs < HOUR_MS) return `${Math.max(1, Math.floor(untilMs / MINUTE_MS))}m`;
  if (untilMs < DAY_MS) return `${Math.floor(untilMs / HOUR_MS)}h`;
  return `${Math.floor(untilMs / DAY_MS)}d`;
};

/** Build the Ask dialog's switch button text, with the quota the peer loses at its reset. */
export const limitSwitchActionLabel = (input: {
  readonly accountLabel: string;
  readonly lostPercent: number | undefined;
  readonly resetsAtMs: number | undefined;
  readonly nowMs: number;
}): string => {
  const base = `Switch to ${input.accountLabel} and continue`;
  if (input.lostPercent === undefined || input.resetsAtMs === undefined) return base;
  const lostPercent = Math.round(input.lostPercent);
  if (lostPercent <= 0) return base;
  return `${base} (${lostPercent}% expires in ${formatTimeUntil(input.resetsAtMs - input.nowMs)})`;
};
