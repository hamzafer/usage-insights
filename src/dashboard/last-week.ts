import type { Report } from "../report/build.ts";
import type { Basis } from "../window-model.ts";

/**
 * The Overview's "Last week" line (spec: Cycles that reset, Limit Hits, Overage, in one quiet row).
 * Its numbers are the Report's week numbers (src/report/build.ts), the same as the Telegram card's
 * "✅ Last week", so the dashboard and the card never disagree. Pure, no I/O.
 */

export interface LastWeekCycle {
  provider: string;
  label: string;
  /** Cycles of this line that reset in the week. */
  resets: number;
  /** Null when none of them has a measurable Waste. Measured and Estimated stay apart. */
  basis: Basis | null;
  /** Average final Waste of those Cycles, 0..1; null when not measurable. */
  waste: number | null;
  /** Average over Cycles that reset in the 4 weeks before; null when none did. */
  previous: number | null;
}

export interface LastWeek {
  from: string;
  to: string;
  cycles: LastWeekCycle[];
  limitHits: {
    count: number;
    /** Average per week over the weeks before that have readings; null when none. */
    previousAvg: number | null;
    blockedMs: number;
  };
  /** Overage spent in the week, summed per unit ("$" or credits); empty without Overage lines. */
  overage: { unit: string; spent: number }[];
}

export function buildLastWeek(report: Report): LastWeek {
  const lineKey = (provider: string, label: string) => `${provider}\u0000${label}`;
  const measured: LastWeekCycle[] = report.trend.waste
    .filter((w) => w.thisWeek !== null)
    .map((w) => ({
      provider: w.provider,
      label: w.label,
      resets: report.cycleWaste.filter((c) => c.provider === w.provider && c.label === w.label && c.waste?.basis === w.basis).length,
      basis: w.basis,
      waste: w.thisWeek,
      previous: w.previous,
    }));
  const withWaste = new Set(measured.map((c) => lineKey(c.provider, c.label)));
  const unmeasured: LastWeekCycle[] = [
    ...Map.groupBy(
      report.cycleWaste.filter((c) => !c.waste && !withWaste.has(lineKey(c.provider, c.label))),
      (c) => lineKey(c.provider, c.label),
    ).values(),
  ].map((cycles) => ({
    provider: cycles[0]!.provider,
    label: cycles[0]!.label,
    resets: cycles.length,
    basis: null,
    waste: null,
    previous: null,
  }));

  return {
    from: report.from,
    to: report.to,
    cycles: [...measured, ...unmeasured],
    limitHits: {
      count: report.trend.limitHits.thisWeek,
      previousAvg: report.trend.limitHits.previousAvg,
      blockedMs: report.trend.blockedMs.thisWeek,
    },
    overage: [...Map.groupBy(report.overage, (o) => o.unit)].map(([unit, lines]) => ({
      unit,
      spent: lines.reduce((sum, o) => sum + o.spent, 0),
    })),
  };
}
