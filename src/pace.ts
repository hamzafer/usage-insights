import type { Basis, Window } from "./window-model.ts";

/**
 * Pace (spec §3): the Waste a running Cycle is heading for at its Reset, if usage continues at the
 * rate seen so far. Linear projection, pure functions, no I/O.
 *
 * When the Window length is known (the reading's `periodMs`), the rate runs from the Cycle's start
 * (its Reset minus the length, usage 0) to the newest reading, so one late spike between two
 * readings cannot say "limit tomorrow". Without a length, the rate runs between the Cycle's first
 * and newest readings.
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

/** Pace for every running Cycle. A rate needs a known Reset and either a Window length or two readings. */
export function paceOfRunningCycles(windows: readonly Window[]): Pace[] {
  return windows
    .filter((w) => w.role === "cycle" && !w.endedAt)
    .map((w) => {
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
        basis: (last.source.startsWith("backfill:claude") ? "estimated" : "measured") as Basis,
      };
      const none = { ...base, projectedShare: null, expectedWaste: null, projectedLimitHitAt: null };
      if (!w.resetsAt || last.limit <= 0) return none;

      const cycleStart = periodMs ? ms(w.resetsAt) - periodMs : null;
      const anchored = cycleStart !== null && cycleStart < ms(last.fetchedAt);
      const elapsed = anchored ? ms(last.fetchedAt) - cycleStart : ms(last.fetchedAt) - ms(first.fetchedAt);
      const growth = anchored ? Math.max(0, last.used) : Math.max(0, last.used - first.used);
      if (elapsed <= 0) return none;

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

function ms(iso: string): number {
  return Date.parse(iso);
}
