import { claudeCalibration } from "../calibration.ts";
import { findLimitHits, type LimitHit } from "../limits.ts";
import { overageUnit } from "../overage.ts";
import { type Pace, paceOfRunningCycles } from "../pace.ts";
import { type GapMarker, READING_GAP_TOLERANCE_MS } from "../sessions.ts";
import type { TokenEvent } from "../store.ts";
import { type TokenShares, topUsage } from "../token-shares.ts";
import { type Basis, deriveWindows, type Reading, type Waste, type Window } from "../window-model.ts";

/**
 * The Report's numbers (spec §6, GLOSSARY: Report): computed without Claude, so they go out even
 * when Suggestions cannot be written. Pure functions, no I/O.
 */

export interface ReportInput {
  /** Session, Cycle and Overage readings (Snapshots and Backfills). */
  readings: readonly Reading[];
  /** Recorder gap markers: time around them is unknown. */
  gaps: readonly GapMarker[];
  /** Token events: at least the Report's week and the 4 weeks before it; all of them for the Claude calibration. */
  tokens: readonly TokenEvent[];
  now: string;
  /** Problems getting fresh data (e.g. a failed Backfill), shown in the Report as they are. */
  dataNotes?: readonly string[];
}

export interface CycleWaste {
  provider: string;
  label: string;
  /** The Cycle's Reset, within the week. */
  resetAt: string;
  /** Null when it cannot be measured (e.g. no limit in the readings). Estimated (Claude, from tokens) is marked by its basis. */
  waste: Waste | null;
  /** Estimated only: the Cycle's span was stepped from a recorded Reset, not recorded itself. */
  inferred?: boolean;
}

export interface WeekLimitHit extends LimitHit {
  /** The part of its Blocked Time that falls within the week. */
  blockedInWeekMs: number;
}

export interface WeekOverage {
  provider: string;
  label: string;
  unit: string;
  /** Growth of the line within the week; drops (the line's own reset) are not spending. */
  spent: number;
}

/** A figure this week next to its average over the previous weeks that have data. */
export interface WeekTrend {
  thisWeek: number;
  /** Null when no previous week has data. */
  previousAvg: number | null;
  previousWeeks: number;
}

export interface WasteTrend {
  provider: string;
  label: string;
  /** Measured and Estimated Waste are never averaged together (GLOSSARY). */
  basis: Basis;
  /** Average final Waste of the Cycles that reset this week; null when none did. */
  thisWeek: number | null;
  /** Average over Cycles that reset in the previous 4 weeks; null when none did. */
  previous: number | null;
  previousCycles: number;
}

export interface ProviderCoverage {
  provider: string;
  /** Readings fetched within the week. */
  readings: number;
  /** Time in the week no readings cover: unknown, not zero use. */
  unknownMs: number;
}

export interface Report {
  from: string;
  to: string;
  cycleWaste: CycleWaste[];
  pace: Pace[];
  limitHits: WeekLimitHit[];
  overage: WeekOverage[];
  /** Tokens per Project and model in the week, all Providers (shares of tokens, not of the allowance). */
  top: TokenShares;
  trend: {
    waste: WasteTrend[];
    limitHits: WeekTrend;
    blockedMs: WeekTrend;
    tokens: WeekTrend;
  };
  coverage: { providers: ProviderCoverage[]; recorderGaps: number };
  dataNotes: string[];
}

export const WEEK_MS = 7 * 24 * 3_600_000;
/** How many weeks before the Report's week the trend compares with. */
export const TREND_WEEKS = 4;
/** Projects and models named in the Report. */
export const REPORT_TOP = 5;

export function buildReport(input: ReportInput): Report {
  const toMs = ms(input.now);
  const fromMs = toMs - WEEK_MS;
  const windows = deriveWindows(
    input.readings.filter((r) => r.role === "session" || r.role === "cycle"),
    input.now,
  );
  const overageReadings = input.readings.filter((r) => r.role === "overage");
  const hits = findLimitHits(windows, overageReadings, input.now);

  const previous = Array.from({ length: TREND_WEEKS }, (_, i) => ({
    from: fromMs - (i + 1) * WEEK_MS,
    to: fromMs - i * WEEK_MS,
  }));
  const firstReading = Math.min(...input.readings.map((r) => ms(r.fetchedAt)));
  const firstToken = Math.min(...input.tokens.map((e) => ms(e.at)));
  const readingWeeks = previous.filter((w) => firstReading < w.to);
  const tokenWeeks = previous.filter((w) => firstToken < w.to);

  const ended = endedCycleWaste(windows, input);
  const weekHits = hitsBetween(hits, fromMs, toMs, toMs);
  const tokensBetween = (from: number, to: number) => topUsage(input.tokens, { from: iso(from), to: iso(to) }).total;

  return {
    from: iso(fromMs),
    to: iso(toMs),
    cycleWaste: resetBetween(ended, fromMs, toMs),
    pace: paceOfRunningCycles(windows),
    limitHits: weekHits,
    overage: overageBetween(overageReadings, fromMs, toMs),
    top: topUsage(input.tokens, { from: iso(fromMs), to: iso(toMs), limit: REPORT_TOP }),
    trend: {
      waste: wasteTrend(ended, fromMs, toMs),
      limitHits: trendOf(weekHits.length, readingWeeks.map((w) => hitsBetween(hits, w.from, w.to, toMs).length)),
      blockedMs: trendOf(
        sumBlocked(weekHits),
        readingWeeks.map((w) => sumBlocked(hitsBetween(hits, w.from, w.to, toMs))),
      ),
      tokens: trendOf(
        tokensBetween(fromMs, toMs),
        tokenWeeks.map((w) => tokensBetween(w.from, w.to)),
      ),
    },
    coverage: {
      providers: coverage(input.readings, input.gaps, fromMs, toMs),
      recorderGaps: input.gaps.filter((g) => ms(g.recordedAt) >= fromMs && ms(g.recordedAt) < toMs).length,
    },
    dataNotes: [...(input.dataNotes ?? [])],
  };
}

/**
 * Final Waste of every ended Cycle: Measured from the Window Model, plus Claude's Estimated Waste
 * (ticket #8) for Cycles without a Measured one. The two stay apart by their basis.
 */
function endedCycleWaste(windows: readonly Window[], input: ReportInput): CycleWaste[] {
  const measured = windows
    .filter((w) => w.role === "cycle" && w.endedAt)
    .map((w) => ({ provider: w.provider, label: w.label, resetAt: w.endedAt!, waste: w.waste }));
  const estimated = claudeCalibration(input.readings, input.tokens, input.now).estimates.map((e) => ({
    provider: e.provider,
    label: e.label,
    resetAt: e.to,
    waste: { share: e.share, lastReadingAt: e.to, lowConfidence: false, basis: e.basis },
    inferred: e.inferred,
  }));
  return [...measured, ...estimated].toSorted(
    (a, b) => compare(a.provider, b.provider) || compare(a.label, b.label) || ms(a.resetAt) - ms(b.resetAt),
  );
}

/** Cycles whose Reset falls in `from`..`to` (end inclusive: a Reset at `now` counts). */
function resetBetween(cycles: readonly CycleWaste[], from: number, to: number): CycleWaste[] {
  return cycles.filter((c) => ms(c.resetAt) >= from && ms(c.resetAt) <= to);
}

/** Limit Hits whose Blocked Time overlaps `from`..`to`, with the overlap. */
function hitsBetween(hits: readonly LimitHit[], from: number, to: number, now: number): WeekLimitHit[] {
  return hits.flatMap((h) => {
    const start = ms(h.hitAt);
    const end = h.blockedUntil ? ms(h.blockedUntil) : now;
    if (start >= to || end < from) return [];
    return [{ ...h, blockedInWeekMs: Math.max(0, Math.min(end, to) - Math.max(start, from)) }];
  });
}

function sumBlocked(hits: readonly WeekLimitHit[]): number {
  return hits.reduce((sum, h) => sum + h.blockedInWeekMs, 0);
}

/** Per Overage line with readings in the week: its growth between readings fetched in the week. */
function overageBetween(readings: readonly Reading[], from: number, to: number): WeekOverage[] {
  const lines = Map.groupBy(readings, (r) => `${r.provider}\u0000${r.label}`);
  const out: WeekOverage[] = [];
  for (const line of lines.values()) {
    const sorted = line.toSorted((a, b) => ms(a.fetchedAt) - ms(b.fetchedAt));
    const inWeek = (r: Reading) => ms(r.fetchedAt) >= from && ms(r.fetchedAt) < to;
    if (!sorted.some(inWeek)) continue;
    let spent = 0;
    sorted.forEach((r, i) => {
      const before = sorted[i - 1];
      if (before && inWeek(r) && r.used > before.used) spent += r.used - before.used;
    });
    const { provider, label } = sorted[0]!;
    out.push({ provider, label, unit: overageUnit(provider, label), spent });
  }
  return out.toSorted((a, b) => compare(a.provider, b.provider) || compare(a.label, b.label));
}

function wasteTrend(cycles: readonly CycleWaste[], from: number, to: number): WasteTrend[] {
  const withWaste = cycles.filter((c) => c.waste);
  const recent = resetBetween(withWaste, from, to);
  const earlier = resetBetween(withWaste, from - TREND_WEEKS * WEEK_MS, from - 1);
  const key = (c: CycleWaste) => `${c.provider}\u0000${c.label}\u0000${c.waste!.basis}`;
  const keys = [...new Set([...recent, ...earlier].map(key))].toSorted();
  return keys.map((k) => {
    const mine = recent.filter((c) => key(c) === k);
    const before = earlier.filter((c) => key(c) === k);
    const [provider, label, basis] = k.split("\u0000") as [string, string, Basis];
    return {
      provider,
      label,
      basis,
      thisWeek: average(mine.map((c) => c.waste!.share)),
      previous: average(before.map((c) => c.waste!.share)),
      previousCycles: before.length,
    };
  });
}

function trendOf(thisWeek: number, previousWeeks: number[]): WeekTrend {
  return { thisWeek, previousAvg: average(previousWeeks), previousWeeks: previousWeeks.length };
}

/**
 * Per Provider, the time in the week covered by readings: between consecutive readings at most
 * `READING_GAP_TOLERANCE_MS` apart with no recorder gap marker between them (as Idle Capacity counts it).
 */
function coverage(readings: readonly Reading[], gaps: readonly GapMarker[], from: number, to: number): ProviderCoverage[] {
  const gapTimes = gaps.map((g) => ms(g.recordedAt));
  return [...Map.groupBy(readings, (r) => r.provider)]
    .toSorted(([a], [b]) => compare(a, b))
    .map(([provider, own]) => {
      const times = [...new Set(own.map((r) => ms(r.fetchedAt)))].toSorted((a, b) => a - b);
      let covered = 0;
      for (let i = 1; i < times.length; i++) {
        const a = times[i - 1]!;
        const b = times[i]!;
        if (b - a > READING_GAP_TOLERANCE_MS || gapTimes.some((g) => g > a && g < b)) continue;
        covered += Math.max(0, Math.min(b, to) - Math.max(a, from));
      }
      return {
        provider,
        readings: times.filter((t) => t >= from && t < to).length,
        unknownMs: to - from - covered,
      };
    });
}

function average(values: readonly number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function ms(t: string): number {
  return Date.parse(t);
}

function iso(t: number): string {
  return new Date(t).toISOString();
}
