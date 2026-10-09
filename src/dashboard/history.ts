import { claudeCalibration } from "../calibration.ts";
import { findLimitHits, type LimitHit } from "../limits.ts";
import { basisOfSource } from "../providers.ts";
import { type Basis, deriveWindows, type Window } from "../window-model.ts";
import type { DashboardData } from "./view-model.ts";

/**
 * Waste and Limit history (`GET /api/history/:provider`, ticket #20): every Cycle of one Provider,
 * ended and running, with its used and wasted share, basis and confidence, and its Limit Hits.
 * Pure function over the stored data, no I/O.
 *
 * Measured and Estimated never mix in one Cycle: an ended Cycle's numbers come either from its
 * readings (Snapshots, or a Backfill whose basis follows its source) or, for a Claude Cycle without
 * any Waste from readings, from tokens via the calibration (`estimateCycleWaste`), never both.
 */

export interface HistoryLimitHit {
  /** The Window that hit its limit: the Cycle itself or a Session inside it. */
  role: "session" | "cycle";
  label: string;
  hitAt: string;
  /** Blocked Time in ms; while still blocked, the time so far. */
  blockedMs: number;
  blockedUntil: string | null;
  endedBy: LimitHit["endedBy"];
}

export interface HistoryCycle {
  /** The Cycle line (e.g. "Weekly"). */
  label: string;
  /** The Cycle's start (the previous Reset); null when unknown. */
  from: string | null;
  /** Its Reset: when it ended, or when it is due while running (null when not reported). */
  resetAt: string | null;
  running: boolean;
  /** Share of the allowance used at the last reading (ended) or the newest one (running), 0..1. */
  usedShare: number;
  /** Unused share at the Reset, 0..1; null while running. */
  wasteShare: number | null;
  basis: Basis;
  /** Ended Cycles with Waste from readings: the last reading is more than 30 minutes before the Reset. */
  lowConfidence: boolean;
  /** Estimated from tokens only: the Cycle's dates were stepped or assumed rather than recorded. */
  inferred: boolean;
  /** Limit Hits of the Cycle and of the Sessions inside it, oldest first. */
  limitHits: HistoryLimitHit[];
}

export interface CycleHistory {
  provider: string;
  /** Oldest first; the running Cycle (if any) last on its line. */
  cycles: HistoryCycle[];
}

/** Two Resets this close are the same Cycle (a token Cycle's stepped end vs a recorded Reset). */
const SAME_RESET_MS = 60 * 60_000;

/** The Provider's Cycle history; null when nothing about its Cycles is known. */
export function buildCycleHistory(data: DashboardData, provider: string, now: string | Date): CycleHistory | null {
  const readings = data.readings.filter((r) => r.provider === provider);
  const windows = deriveWindows(
    readings.filter((r) => r.role === "session" || r.role === "cycle"),
    now,
  );
  const cycleWindows = windows.filter((w) => w.role === "cycle");

  const fromReadings: HistoryCycle[] = cycleWindows.flatMap((w) => {
    const line = cycleWindows.filter((c) => c.label === w.label);
    const from = startOf(w, line[line.indexOf(w) - 1]);
    if (w.endedAt === null) {
      const last = w.readings.at(-1)!;
      return [
        cycle(w.label, from, w.resetsAt, true, shareOf(last.used, last.limit), null, basisOfSource(last.source), false),
      ];
    }
    if (!w.waste) return [];
    return [cycle(w.label, from, w.endedAt, false, 1 - w.waste.share, w.waste.share, w.waste.basis, w.waste.lowConfidence)];
  });

  const ended = fromReadings.filter((c) => !c.running);
  const estimated: HistoryCycle[] = claudeCalibration(readings, (data.tokens ?? []).filter((e) => e.provider === provider), now)
    .estimates.filter((e) => !ended.some((c) => Math.abs(ms(c.resetAt!) - ms(e.to)) <= SAME_RESET_MS))
    .map((e) => cycle(e.label, e.from, e.to, false, Math.min(1, e.usedShare), e.share, "estimated", false, e.inferred));

  const cycles = [...fromReadings, ...estimated].toSorted(
    (a, b) => Number(a.running) - Number(b.running) || resetMs(a) - resetMs(b),
  );
  if (cycles.length === 0) return null;

  const overage = readings.filter((r) => r.role === "overage");
  for (const hit of findLimitHits(windows, overage, now)) {
    const at = ms(hit.hitAt);
    const owner = cycles.find((c) => (c.from === null || ms(c.from) <= at) && (c.resetAt === null || at < ms(c.resetAt)));
    owner?.limitHits.push({
      role: hit.role as "session" | "cycle",
      label: hit.label,
      hitAt: hit.hitAt,
      blockedMs: hit.blockedMs,
      blockedUntil: hit.blockedUntil,
      endedBy: hit.endedBy,
    });
  }
  for (const c of cycles) c.limitHits.sort((a, b) => ms(a.hitAt) - ms(b.hitAt));
  return { provider, cycles };
}

function cycle(
  label: string,
  from: string | null,
  resetAt: string | null,
  running: boolean,
  usedShare: number,
  wasteShare: number | null,
  basis: Basis,
  lowConfidence: boolean,
  inferred = false,
): HistoryCycle {
  return {
    label,
    from,
    resetAt,
    running,
    usedShare: round(clamp(usedShare)),
    wasteShare: wasteShare === null ? null : round(wasteShare),
    basis,
    lowConfidence,
    inferred,
    limitHits: [],
  };
}

/** A Window's start: the previous Window's end on its line, else its Reset minus its reported length. */
function startOf(w: Window, previous: Window | undefined): string | null {
  if (previous?.endedAt) return previous.endedAt;
  const periodMs = w.readings.findLast((r) => r.periodMs)?.periodMs;
  return periodMs && w.resetsAt ? new Date(ms(w.resetsAt) - periodMs).toISOString() : null;
}

function resetMs(c: HistoryCycle): number {
  return c.resetAt === null ? Number.MAX_SAFE_INTEGER : ms(c.resetAt);
}

function shareOf(used: number, limit: number): number {
  return limit > 0 ? used / limit : 0;
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function ms(iso: string): number {
  return Date.parse(iso);
}
