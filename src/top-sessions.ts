import type { Calibration } from "./calibration.ts";
import { modelName } from "./names.ts";
import { projectName } from "./projects.ts";
import { isCalibrated } from "./providers.ts";
import type { SessionTokenEvent } from "./store.ts";
import { tokenTotal } from "./token-shares.ts";
import type { Reading } from "./window-model.ts";

/**
 * Top sessions (ticket #21): the biggest Claude Code and Codex sessions in a range, by tokens, with
 * how much of the 5-hour and weekly limits each took. Pure functions over stored data.
 *
 * Codex (Measured): its logs record the limits on every call, so the Codex Backfill's readings at
 * the session's call times show how far each limit moved during the session, from the account's
 * last reading before it (same window). Sessions running side by side share one limit, so each
 * shows the movement while it ran. Claude (Estimated): tokens converted with the account's
 * calibration once it is ready; tokens only until then.
 */

export const TOP_SESSION_RANGES = { "7d": 7, "30d": 30 } as const;
export type TopSessionRange = keyof typeof TOP_SESSION_RANGES;
export const DEFAULT_TOP_SESSIONS = 10;
export const MAX_TOP_SESSIONS = 50;

export interface TopSession {
  provider: string;
  /** The session's id in its logs. */
  id: string;
  /** The main Project's folder name (most tokens), never its path; "(other)" when none. */
  project: string;
  /** The model with the most tokens. */
  model: string;
  /** Its display name ("Opus 5.5"), as in Tokens by model. */
  modelName: string;
  /** The first and last call in the range. */
  startedAt: string;
  endedAt: string;
  calls: number;
  tokens: number;
  /** Share of the 5-hour limit the session took, 0..1 (above 1 is possible); null when unknown. */
  sessionShare: number | null;
  /** Share of the weekly limit, 0..1; null when unknown. */
  weeklyShare: number | null;
  /** How the shares were found; null when both are unknown (tokens only). */
  basis: "measured" | "estimated" | null;
}

export interface TopSessionsInput {
  /** Token events with their session (store.sessionTokenUsage). */
  events: readonly SessionTokenEvent[];
  /** Stored readings of any source (Codex Backfill readings are used). */
  readings: readonly Reading[];
  /** Claude calibrations (claudeCalibration); only ready ones are used. */
  calibrations: readonly Calibration[];
  now: string | Date;
  range: TopSessionRange;
  limit?: number;
  /** Only this Provider's sessions; every Provider's when omitted. */
  provider?: string;
}

const DAY_MS = 24 * 3_600_000;
/** Codex reports a window's Reset with a few seconds' jitter; further apart is another window. */
const SAME_WINDOW_MS = 2 * 60_000;
const CODEX_SOURCE = "backfill:codex";

export function topSessions({
  events,
  readings,
  calibrations,
  now,
  range,
  limit = DEFAULT_TOP_SESSIONS,
  provider,
}: TopSessionsInput): TopSession[] {
  const inRange = sessionEventsInRange(events, now, range).filter((e) => provider === undefined || e.provider === provider);
  const codexLines = codexReadings(readings);

  const sessions = [...Map.groupBy(inRange, (e) => `${e.provider}\u0000${e.session}`).values()].map((calls) => {
    const first = calls[0]!;
    const tokens = calls.reduce((sum, e) => sum + tokenTotal(e), 0);
    const times = calls.map((e) => e.at).toSorted();
    const row: TopSession = {
      provider: first.provider,
      id: first.session!,
      project: projectName(biggest(calls, (e) => e.project)),
      model: biggest(calls, (e) => e.model) ?? "unknown",
      modelName: "",
      startedAt: times[0]!,
      endedAt: times.at(-1)!,
      calls: calls.length,
      tokens,
      sessionShare: null,
      weeklyShare: null,
      basis: null,
    };
    row.modelName = modelName(row.model);
    if (first.provider === "codex") {
      row.sessionShare = codexMovement(codexLines.get("Session"), times);
      row.weeklyShare = codexMovement(codexLines.get("Weekly"), times);
      if (row.sessionShare !== null || row.weeklyShare !== null) row.basis = "measured";
    } else if (isCalibrated(first.provider)) {
      row.sessionShare = estimate(calibrations, first.provider, "session", tokens);
      row.weeklyShare = estimate(calibrations, first.provider, "cycle", tokens);
      if (row.sessionShare !== null || row.weeklyShare !== null) row.basis = "estimated";
    }
    return row;
  });

  return sessions
    .toSorted((a, b) => b.tokens - a.tokens || (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
    .slice(0, limit);
}

/** The Providers with at least one session in the range, sorted by id (for a Provider filter). */
export function sessionProviders(events: readonly SessionTokenEvent[], now: string | Date, range: TopSessionRange): string[] {
  return [...new Set(sessionEventsInRange(events, now, range).map((e) => e.provider))].toSorted();
}

function sessionEventsInRange(events: readonly SessionTokenEvent[], now: string | Date, range: TopSessionRange): SessionTokenEvent[] {
  const to = typeof now === "string" ? Date.parse(now) : now.getTime();
  const from = to - TOP_SESSION_RANGES[range] * DAY_MS;
  return events.filter((e) => {
    const at = Date.parse(e.at);
    return e.session !== null && at >= from && at <= to;
  });
}

/** The value with the most tokens among the calls (ties: the first seen). */
function biggest<T>(calls: readonly SessionTokenEvent[], of: (e: SessionTokenEvent) => T): T | null {
  const totals = new Map<T, number>();
  for (const e of calls) totals.set(of(e), (totals.get(of(e)) ?? 0) + tokenTotal(e));
  let best: T | null = null;
  let most = -1;
  for (const [value, n] of totals) {
    if (n > most) {
      best = value;
      most = n;
    }
  }
  return best;
}

/** Codex Backfill readings per line label ("Session", "Weekly"), oldest first, and by time. */
interface CodexLine {
  sorted: Reading[];
  byTime: Map<string, Reading>;
}

function codexReadings(readings: readonly Reading[]): Map<string, CodexLine> {
  const out = new Map<string, CodexLine>();
  const own = readings.filter((r) => r.provider === "codex" && r.source === CODEX_SOURCE && (r.label === "Session" || r.label === "Weekly"));
  for (const [label, line] of Map.groupBy(own, (r) => r.label)) {
    const sorted = line.toSorted((a, b) => Date.parse(a.fetchedAt) - Date.parse(b.fetchedAt));
    out.set(label, { sorted, byTime: new Map(sorted.map((r) => [new Date(r.fetchedAt).toISOString(), r])) });
  }
  return out;
}

/**
 * How far the line's used % moved over the session's calls, as a share: from the account's last
 * reading before the session (when it is the same window) through each call's reading. A Reset
 * starts the new window from 0. Null when none of the calls has a reading.
 */
function codexMovement(line: CodexLine | undefined, times: readonly string[]): number | null {
  if (!line) return null;
  const own = times.flatMap((t) => {
    const r = line.byTime.get(new Date(t).toISOString());
    return r ? [r] : [];
  });
  if (own.length === 0) return null;
  const startMs = Date.parse(own[0]!.fetchedAt);
  const before = line.sorted.findLast((r) => Date.parse(r.fetchedAt) < startMs);
  let prev = before && sameWindow(before, own[0]!) ? before : own[0]!;
  let moved = 0;
  for (const r of own) {
    moved += sameWindow(prev, r) ? Math.max(0, percent(r) - percent(prev)) : percent(r);
    prev = r;
  }
  return moved / 100;
}

function sameWindow(a: Reading, b: Reading): boolean {
  if (a.resetsAt === null || b.resetsAt === null) return a.resetsAt === b.resetsAt;
  return Math.abs(Date.parse(a.resetsAt) - Date.parse(b.resetsAt)) <= SAME_WINDOW_MS;
}

function percent(r: Reading): number {
  return r.limit > 0 ? (r.used / r.limit) * 100 : 0;
}

/** Tokens as a share of a Claude limit with the account's ready calibration; null while calibrating. */
function estimate(calibrations: readonly Calibration[], provider: string, role: "session" | "cycle", tokens: number): number | null {
  const own = calibrations.filter((c) => c.provider === provider && c.role === role && c.ready && c.tokensPerPercent);
  const label = role === "session" ? "Session" : "Weekly";
  const calibration = own.find((c) => c.label === label) ?? own[0];
  return calibration ? tokens / (calibration.tokensPerPercent! * 100) : null;
}
