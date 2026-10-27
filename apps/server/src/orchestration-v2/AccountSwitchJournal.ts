import type {
  OrchestrationV2Run,
  ProviderInstanceId,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

export type AccountSwitchReason = "near-limit" | "mid-turn" | "usage-limit" | "signed-out";

export interface AccountSwitchNote {
  readonly from: ProviderInstanceId;
  readonly to: ProviderInstanceId;
  readonly reason: AccountSwitchReason;
  /** The usage window that pushed the account over, such as "5-hour" at 92 percent. */
  readonly pressure?: { readonly windowLabel: string; readonly usedPercent: number };
}

/** Find the run that started before this one, whose account a new run may have left. */
export const previousStartedRun = (
  run: Pick<OrchestrationV2Run, "ordinal">,
  runs: ReadonlyArray<OrchestrationV2Run>,
): OrchestrationV2Run | undefined =>
  runs
    .filter((candidate) => candidate.ordinal < run.ordinal && candidate.startedAt !== null)
    .reduce<OrchestrationV2Run | undefined>(
      (latest, candidate) =>
        latest === undefined || candidate.ordinal > latest.ordinal ? candidate : latest,
      undefined,
    );

/** Name the window behind a switch decision by its label on the account's usage reading. */
export const notePressure = (
  providers: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
  pressure: { readonly windowId: string; readonly usedPercent: number } | undefined,
): AccountSwitchNote["pressure"] => {
  if (pressure === undefined) return undefined;
  const window = providers
    .find((provider) => provider.instanceId === instanceId)
    ?.usageLimits?.windows.find((candidate) => candidate.id === pressure.windowId);
  return window === undefined
    ? undefined
    : { windowLabel: window.label, usedPercent: pressure.usedPercent };
};

/**
 * Write the timeline line for a run that moved to another account, naming the
 * window that caused the move when the switch recorded one.
 */
export const accountSwitchNoticeText = (input: {
  readonly fromName: string;
  readonly toName: string;
  readonly note: AccountSwitchNote | undefined;
}): string => {
  const { fromName, toName, note } = input;
  if (note === undefined) return `Switched to ${toName} from ${fromName}`;
  const move =
    note.reason === "mid-turn" || note.reason === "usage-limit"
      ? `Continued on ${toName}`
      : `Switched to ${toName}`;
  if (note.reason === "signed-out") return `${move} because ${fromName} is signed out`;
  if (note.reason === "usage-limit") return `${move} because ${fromName} hit its usage limit`;
  if (note.pressure === undefined) return `${move} because ${fromName} is near its usage limit`;
  const usedPercent = Math.round(note.pressure.usedPercent);
  return `${move} because ${fromName} reached ${usedPercent}% of its ${note.pressure.windowLabel} limit`;
};

export class AccountSwitchJournal extends Context.Service<
  AccountSwitchJournal,
  {
    readonly record: (threadId: ThreadId, note: AccountSwitchNote) => Effect.Effect<void>;
    /** Remove and return a recent note naming `to`, the account the thread's new run starts on. */
    readonly take: (
      threadId: ThreadId,
      to: ProviderInstanceId,
    ) => Effect.Effect<Option.Option<AccountSwitchNote>>;
  }
>()("t3/orchestration-v2/AccountSwitchJournal") {}

const NOTE_TTL_MS = 5 * 60_000;

export const make = Effect.gen(function* () {
  const notes = yield* Ref.make(
    new Map<ThreadId, { readonly note: AccountSwitchNote; readonly atMs: number }>(),
  );
  return AccountSwitchJournal.of({
    record: (threadId, note) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((atMs) =>
          Ref.update(notes, (current) => new Map(current).set(threadId, { note, atMs })),
        ),
      ),
    take: (threadId, to) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((nowMs) =>
          Ref.modify(notes, (current) => {
            const entry = current.get(threadId);
            if (entry === undefined) return [Option.none(), current];
            const next = new Map(current);
            if (nowMs - entry.atMs >= NOTE_TTL_MS) {
              next.delete(threadId);
              return [Option.none(), next];
            }
            if (entry.note.to !== to) return [Option.none(), current];
            next.delete(threadId);
            return [Option.some(entry.note), next];
          }),
        ),
      ),
  });
});

export const layer = Layer.effect(AccountSwitchJournal, make);
