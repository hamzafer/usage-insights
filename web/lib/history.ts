import type { Range } from "./range";
import type { Basis, HistoryCycle } from "./types";

/**
 * Waste and Limit history (#20): pure helpers for the section, tested with `bun test`.
 * The range toggle picks how many Cycles show, not a time span: Cycles are a week or a month long,
 * so "7d" shows the last few and "30d" a longer stretch, counted the same for every Provider.
 */

/** Cycles shown per range, the running one included. */
export const CYCLES_PER_RANGE: Record<Range, number> = { "7d": 4, "30d": 12 };

/** "Last 4 Cycles". */
export function rangeCaption(range: Range): string {
  return `Last ${CYCLES_PER_RANGE[range]} Cycles`;
}

/** The newest Cycles for the range, oldest first. */
export function cyclesForRange(cycles: readonly HistoryCycle[], range: Range): HistoryCycle[] {
  return cycles.slice(-CYCLES_PER_RANGE[range]);
}

export interface Averages {
  basis: Basis;
  /** Ended Cycles averaged. */
  count: number;
  used: number;
  wasted: number;
}

/**
 * Average used and wasted share over the ended Cycles, one figure per basis: Measured and
 * Estimated are never mixed (GLOSSARY). Measured first; a basis without ended Cycles is left out.
 */
export function averages(cycles: readonly HistoryCycle[]): Averages[] {
  return (["measured", "estimated"] as const).flatMap((basis) => {
    const own = cycles.filter((c) => !c.running && c.wasteShare !== null && c.basis === basis);
    if (own.length === 0) return [];
    const mean = (f: (c: HistoryCycle) => number) => own.reduce((sum, c) => sum + f(c), 0) / own.length;
    return [{ basis, count: own.length, used: mean((c) => c.usedShare), wasted: mean((c) => c.wasteShare!) }];
  });
}

/** Blocked Time, coarse: "3d 17h", "5h 20m", "45m", "0m". */
export function blockedText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/** Total Blocked Time of a Cycle's Limit Hits. */
export function blockedTotal(cycle: HistoryCycle): number {
  return cycle.limitHits.reduce((sum, h) => sum + h.blockedMs, 0);
}
