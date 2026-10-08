import { basisOfSource } from "./providers.ts";
import type { Basis, Window } from "./window-model.ts";

/**
 * Pace (spec §3): the Waste a running Cycle is heading for at its Reset, if usage continues at the
 * rate seen so far. Linear projection, pure functions, no I/O.
 *
 * When the Cycle's start is known, the rate runs from it (usage 0) to the newest reading, so one late
 * spike between two readings cannot say "limit tomorrow". The start is the later of the Reset minus
 * the Window length (the reading's `periodMs`) and the previous Window's end on the same line (an
 * early Reset). Without either, the rate runs between the Cycle's first and newest readings, and
 * only once they span 24 hours or 10% of the Cycle; before that there is no rate yet.
 */
export interface Pace {
  provider: string;
  label: string;
  resetsAt: string | null;
  /** The newest reading the projection starts from. */
  lastReadingAt: string;
  /** Share of the allowance used at the newest reading, 0..1 (0 when the limit is unknown). */
  usedShare: number;
  /** The Cycle's length, when reported; Pace is then anchored at the Cycle's start. */
  periodMs: number | null;
  /** Projected share of the allowance used at the Reset, 0..1; null without a rate yet. */
  projectedShare: number | null;
  /** Projected Waste at the Reset, 0..1; null without a rate yet. */
  expectedWaste: number | null;
  /** When usage would reach the limit before the Reset at this rate, else null. */
  projectedLimitHitAt: string | null;
  basis: Basis;
}

/**
 * Pace for every running Cycle. A rate needs a known Reset and either a known Cycle start (anchor)
 * or the Cycle's own readings spanning MIN_RATE_SPAN_MS or MIN_RATE_SHARE of the Cycle.
 */
export function paceOfRunningCycles(windows: readonly Window[]): Pace[] {
  return windows
    .map((w, i) => ({ w, previous: windows[i - 1] }))
    .filter(({ w }) => w.role === "cycle" && !w.endedAt)
    .map(({ w, previous }) => {
      const first = w.readings[0]!;
      const last = w.readings.at(-1)!;
      const periodMs = w.readings.findLast((r) => r.periodMs)?.periodMs ?? null;
      const base = {
        provider: w.provider,
        label: w.label,
        resetsAt: w.resetsAt,
        lastReadingAt: last.fetchedAt,
        usedShare: last.limit > 0 ? last.used / last.limit : 0,
        periodMs,
        basis: basisOfSource(last.source),
      };
      const none = { ...base, projectedShare: null, expectedWaste: null, projectedLimitHitAt: null };
      if (!w.resetsAt || last.limit <= 0) return none;

      // The Cycle's start (usage 0): the later of Reset − length and the previous Window's end on
      // this line (after an early Reset, the new Cycle started then, not a full length before its Reset).
      const previousEnd =
        previous && previous.provider === w.provider && previous.label === w.label && previous.endedAt
          ? ms(previous.endedAt)
          : null;
      const starts = [periodMs ? ms(w.resetsAt) - periodMs : null, previousEnd].filter((t): t is number => t !== null);
      const cycleStart = starts.length ? Math.max(...starts) : null;
      const anchored = cycleStart !== null && cycleStart < ms(last.fetchedAt);
      const elapsed = anchored ? ms(last.fetchedAt) - cycleStart : ms(last.fetchedAt) - ms(first.fetchedAt);
      const growth = anchored ? Math.max(0, last.used) : Math.max(0, last.used - first.used);
      if (elapsed <= 0) return none;
      // Unanchored, a rate from a short stretch of readings says little: wait for 24 hours of them,
      // or 10% of the Cycle (from the first reading to the Reset, the shortest it can be).
      if (!anchored) {
        const cycleMs = ms(w.resetsAt) - ms(first.fetchedAt);
        if (elapsed < MIN_RATE_SPAN_MS && elapsed < MIN_RATE_SHARE * cycleMs) return none;
      }

      const remaining = Math.max(0, ms(w.resetsAt) - ms(last.fetchedAt));
      const projected = Math.min(last.limit, last.used + (growth * remaining) / elapsed);
      const toLimit = last.limit - last.used;
      const limitHitMs =
        growth > 0 && toLimit > 0 && (toLimit * elapsed) / growth < remaining
          ? ms(last.fetchedAt) + (toLimit * elapsed) / growth
          : null;
      return {
        ...base,
        projectedShare: projected / last.limit,
        expectedWaste: (last.limit - projected) / last.limit,
        projectedLimitHitAt: limitHitMs === null ? null : new Date(limitHitMs).toISOString(),
      };
    });
}

/** Without a known Cycle start, readings must span this long before Pace projects... */
export const MIN_RATE_SPAN_MS = 24 * 3_600_000;
/** ...or this share of the Cycle (for short Cycles). */
export const MIN_RATE_SHARE = 0.1;

function ms(iso: string): number {
  return Date.parse(iso);
}
