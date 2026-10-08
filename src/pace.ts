import type { Basis, Window } from "./window-model.ts";

/**
 * Pace (spec §3): the Waste a running Cycle is heading for at its Reset, if usage continues at the
 * rate seen in the Cycle's readings so far. Linear projection, pure functions, no I/O.
 */
export interface Pace {
  provider: string;
  label: string;
  resetsAt: string | null;
  /** The newest reading the projection starts from. */
  lastReadingAt: string;
  /** Projected share of the allowance used at the Reset, 0..1; null without a rate yet. */
  projectedShare: number | null;
  /** Projected Waste at the Reset, 0..1; null without a rate yet. */
  expectedWaste: number | null;
  /** When usage would reach the limit before the Reset at this rate, else null. */
  projectedLimitHitAt: string | null;
  basis: Basis;
}

/** Pace for every running Cycle. A rate needs two readings at different times and a known Reset. */
export function paceOfRunningCycles(windows: readonly Window[]): Pace[] {
  return windows
    .filter((w) => w.role === "cycle" && !w.endedAt)
    .map((w) => {
      const first = w.readings[0]!;
      const last = w.readings.at(-1)!;
      const base = {
        provider: w.provider,
        label: w.label,
        resetsAt: w.resetsAt,
        lastReadingAt: last.fetchedAt,
        basis: (last.source.startsWith("backfill:claude") ? "estimated" : "measured") as Basis,
      };
      const elapsed = ms(last.fetchedAt) - ms(first.fetchedAt);
      if (!w.resetsAt || elapsed <= 0 || last.limit <= 0) {
        return { ...base, projectedShare: null, expectedWaste: null, projectedLimitHitAt: null };
      }
      const growth = Math.max(0, last.used - first.used);
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
