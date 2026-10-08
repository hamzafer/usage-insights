import type { Reading, Window } from "./window-model.ts";

/**
 * Overage per Cycle (spec §3). Overage is paid usage beyond the allowance: it is reported in its
 * own unit (dollars or credits) and never mixed into Waste. Pure functions, no I/O.
 */

export interface CycleOverage {
  provider: string;
  cycleLabel: string;
  /** The Cycle's Reset, or null while it is still running. */
  cycleEndedAt: string | null;
  overageLabel: string;
  /** `$` or `credits` (spec: Line classification). */
  unit: string;
  /** How much the Overage line grew during the Cycle. Drops (the line's own reset) are not spending. */
  spent: number;
}

/** Units of the Overage lines (spec: Line classification), by Provider then label. */
const OVERAGE_UNITS: Record<string, Record<string, string>> = {
  "claude-work": { "Extra usage spent": "$" },
  cursor: { "On-demand": "$" },
  codex: { "Workspace Credits": "credits" },
};

export function overageUnit(provider: string, label: string): string {
  return OVERAGE_UNITS[provider]?.[label] ?? "units";
}

/**
 * One entry per Cycle and Overage line of the same Provider, for Cycles that have Overage readings
 * within their span. A Cycle spans from the previous Cycle's Reset (or its own first reading) to
 * its Reset (or `now` while running).
 */
export function overagePerCycle(
  windows: readonly Window[],
  overage: readonly Reading[],
  now: string | Date,
): CycleOverage[] {
  const nowMs = typeof now === "string" ? ms(now) : now.getTime();
  const lines = [...Map.groupBy(overage, (r) => `${r.provider}\u0000${r.label}`).values()].map((line) =>
    line.toSorted((a, b) => ms(a.fetchedAt) - ms(b.fetchedAt)),
  );

  const out: CycleOverage[] = [];
  windows.forEach((w, i) => {
    if (w.role !== "cycle") return;
    const prev = windows[i - 1];
    const samePrev = prev && prev.provider === w.provider && prev.label === w.label ? prev : undefined;
    const start = ms(samePrev?.endedAt ?? w.readings[0]!.fetchedAt);
    const end = w.endedAt ? ms(w.endedAt) : nowMs;

    for (const line of lines) {
      const first = line[0]!;
      if (first.provider !== w.provider) continue;
      let spent = 0;
      let seen = false;
      line.forEach((r, j) => {
        const t = ms(r.fetchedAt);
        if (t < start || t > end) return;
        seen = true;
        const before = line[j - 1];
        if (before && t > start && r.used > before.used) spent += r.used - before.used;
      });
      if (!seen) continue;
      out.push({
        provider: w.provider,
        cycleLabel: w.label,
        cycleEndedAt: w.endedAt,
        overageLabel: first.label,
        unit: overageUnit(first.provider, first.label),
        spent,
      });
    }
  });
  return out;
}

function ms(iso: string): number {
  return Date.parse(iso);
}
