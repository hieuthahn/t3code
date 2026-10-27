// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
/**
 * Compares Team Auto threads judged team against those judged single, from the app's database.
 * Usage: node scripts/auto-team-report.ts [path/to/statev2.sqlite] [--json]
 */
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

interface Verdict {
  readonly thread_id: string;
  readonly team_after: number;
  readonly switches: number;
  readonly judge_team: number | null;
  readonly team_sure: number | null;
  readonly judged_by: string;
  readonly recorded_at: string;
}

interface TokenTotals {
  input: number;
  cachedInput: number;
  output: number;
  opusOutput: number;
  undercountedTurns: number;
}

interface ThreadReport {
  readonly threadId: string;
  readonly title: string;
  readonly team: boolean;
  readonly teamScore: number | null;
  readonly judgedBy: string;
  readonly switches: number;
  readonly threads: number;
  readonly activeMinutes: number;
  readonly agentMinutes: number;
  readonly tokens: TokenTotals;
  readonly followUps: number;
  readonly interrupts: number;
  readonly errors: number;
  readonly failedAssignments: number;
}

const NEAR_THRESHOLD = { low: 0.4, high: 0.8 } as const;

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const dbPath =
  args.find((arg) => !arg.startsWith("--")) ??
  NodePath.join(NodeOS.homedir(), ".t3-fork", "userdata", "statev2.sqlite");
const db = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });

const all = <T>(query: string, ...params: Array<string>) =>
  db.prepare(query).all(...params) as unknown as Array<T>;

/** The judge's confidence that the thread wanted a team, whichever way it answered. */
function teamScore(verdict: Verdict): number | null {
  if (verdict.judge_team === null || verdict.team_sure === null) return null;
  return verdict.judge_team === 1 ? verdict.team_sure : 1 - verdict.team_sure;
}

/** Minutes covered by at least one run, so parallel workers count once. */
function unionMinutes(intervals: Array<readonly [number, number]>): number {
  const sorted = intervals.toSorted((left, right) => left[0] - right[0]);
  let total = 0;
  let cursor = Number.NEGATIVE_INFINITY;
  for (const [start, end] of sorted) {
    const from = Math.max(start, cursor);
    if (end > from) total += end - from;
    cursor = Math.max(cursor, end);
  }
  return total / 60_000;
}

function threadFamily(rootId: string): Array<string> {
  return [
    rootId,
    ...all<{ thread_id: string }>(
      `SELECT thread_id FROM orchestration_v2_projection_threads
       WHERE json_extract(payload_json, '$.lineage.rootThreadId') = ? AND thread_id <> ?`,
      rootId,
      rootId,
    ).map((row) => row.thread_id),
  ];
}

function report(verdict: Verdict): ThreadReport {
  const family = threadFamily(verdict.thread_id);
  const placeholders = family.map(() => "?").join(", ");
  const runs = all<{ started: string | null; completed: string | null }>(
    `SELECT json_extract(payload_json, '$.startedAt') AS started,
            json_extract(payload_json, '$.completedAt') AS completed
     FROM orchestration_v2_projection_runs WHERE thread_id IN (${placeholders})`,
    ...family,
  ).flatMap((run) =>
    run.started === null || run.completed === null
      ? []
      : [[Date.parse(run.started), Date.parse(run.completed)] as const],
  );
  const tokens: TokenTotals = {
    input: 0,
    cachedInput: 0,
    output: 0,
    opusOutput: 0,
    undercountedTurns: 0,
  };
  for (const turn of all<{ usage: string | null; model: string | null }>(
    `SELECT json_extract(turn.payload_json, '$.turnTokenUsage') AS usage,
            json_extract(run.payload_json, '$.modelSelection.model') AS model
     FROM orchestration_v2_projection_provider_turns AS turn
     LEFT JOIN orchestration_v2_projection_run_attempts AS attempt
       ON attempt.attempt_id = turn.run_attempt_id
     LEFT JOIN orchestration_v2_projection_runs AS run ON run.run_id = attempt.run_id
     WHERE turn.thread_id IN (${placeholders})`,
    ...family,
  )) {
    const usage = turn.usage === null ? undefined : JSON.parse(turn.usage);
    if (usage === undefined || usage.usageStatus !== "complete" || usage.hasSubagents === true) {
      tokens.undercountedTurns += 1;
    }
    if (usage === undefined) continue;
    tokens.input += usage.inputTokens ?? 0;
    tokens.cachedInput += usage.cachedInputTokens ?? 0;
    tokens.output += usage.outputTokens ?? 0;
    if (turn.model?.includes("opus")) tokens.opusOutput += usage.outputTokens ?? 0;
  }
  const countItems = (type: string, threads: Array<string>) =>
    all<{ count: number }>(
      `SELECT count(*) AS count FROM orchestration_v2_projection_turn_items
       WHERE thread_id IN (${threads.map(() => "?").join(", ")})
         AND json_extract(payload_json, '$.type') = ?`,
      ...threads,
      type,
    )[0]?.count ?? 0;
  const failedAssignments =
    all<{ count: number }>(
      `SELECT count(*) AS count FROM team_assignments AS assignment
       JOIN team_runs AS run ON run.run_id = assignment.run_id
       WHERE run.thread_id = ? AND assignment.status IN ('failed', 'cancelled')`,
      verdict.thread_id,
    )[0]?.count ?? 0;
  const title =
    all<{ title: string }>(
      `SELECT title FROM orchestration_v2_projection_threads WHERE thread_id = ?`,
      verdict.thread_id,
    )[0]?.title ?? "";
  return {
    threadId: verdict.thread_id,
    title,
    team: verdict.team_after === 1,
    teamScore: teamScore(verdict),
    judgedBy: verdict.judged_by,
    switches: verdict.switches,
    threads: family.length,
    activeMinutes: unionMinutes(runs),
    agentMinutes: runs.reduce((sum, [start, end]) => sum + (end - start), 0) / 60_000,
    tokens,
    followUps: Math.max(0, countItems("user_message", [verdict.thread_id]) - 1),
    interrupts: countItems("run_interrupt_request", family),
    errors: countItems("error", family),
    failedAssignments,
  };
}

function median(values: Array<number>): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function summarize(label: string, rows: Array<ThreadReport>) {
  const pick = (read: (row: ThreadReport) => number) => median(rows.map(read));
  return {
    group: label,
    threads: rows.length,
    medianActiveMinutes: pick((row) => row.activeMinutes),
    medianAgentMinutes: pick((row) => row.agentMinutes),
    medianInputTokens: pick((row) => row.tokens.input),
    medianUncachedInputTokens: pick((row) => row.tokens.input - row.tokens.cachedInput),
    medianOutputTokens: pick((row) => row.tokens.output),
    medianFollowUps: pick((row) => row.followUps),
    medianInterrupts: pick((row) => row.interrupts),
    undercountedThreads: rows.filter((row) => row.tokens.undercountedTurns > 0).length,
  };
}

const verdicts = all<Verdict>(
  `SELECT launch.thread_id, launch.team_after, launch.judge_team, launch.team_sure,
          launch.judged_by, launch.recorded_at,
          (SELECT count(*) FROM auto_team_verdicts AS later
           WHERE later.thread_id = launch.thread_id AND later.run_ordinal > 1
             AND later.team_before <> later.team_after) AS switches
   FROM auto_team_verdicts AS launch
   WHERE launch.run_ordinal = 1
   ORDER BY launch.recorded_at`,
);
const rows = verdicts.map(report);
const near = rows.filter(
  (row) =>
    row.teamScore !== null &&
    row.teamScore >= NEAR_THRESHOLD.low &&
    row.teamScore <= NEAR_THRESHOLD.high,
);
const summary = [
  summarize(
    "team",
    rows.filter((row) => row.team),
  ),
  summarize(
    "single",
    rows.filter((row) => !row.team),
  ),
  summarize(
    `team, score ${NEAR_THRESHOLD.low}-${NEAR_THRESHOLD.high}`,
    near.filter((row) => row.team),
  ),
  summarize(
    `single, score ${NEAR_THRESHOLD.low}-${NEAR_THRESHOLD.high}`,
    near.filter((row) => !row.team),
  ),
];

if (asJson) {
  console.log(JSON.stringify({ summary, threads: rows }, null, 2));
} else {
  const round = (value: number | null) => (value === null ? "-" : Math.round(value));
  console.table(
    rows.map((row) => ({
      thread: row.threadId.slice(0, 8),
      title: row.title.slice(0, 28),
      team: row.team ? "team" : "single",
      score: row.teamScore === null ? "-" : row.teamScore.toFixed(2),
      by: row.judgedBy,
      switches: row.switches,
      threads: row.threads,
      activeMin: round(row.activeMinutes),
      agentMin: round(row.agentMinutes),
      inputK: round(row.tokens.input / 1000),
      uncachedK: round((row.tokens.input - row.tokens.cachedInput) / 1000),
      outputK: round(row.tokens.output / 1000),
      opusOutK: round(row.tokens.opusOutput / 1000),
      followUps: row.followUps,
      interrupts: row.interrupts,
      failed: row.failedAssignments,
      undercounted: row.tokens.undercountedTurns,
    })),
  );
  console.table(
    summary.map(({ group, threads, undercountedThreads, ...medians }) => ({
      group,
      threads,
      ...Object.fromEntries(Object.entries(medians).map(([key, value]) => [key, round(value)])),
      undercountedThreads,
    })),
  );
  console.log(
    "Turns marked undercounted had subagents or incomplete usage, so their tokens are a floor.",
  );
}
