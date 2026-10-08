import { findLimitHits, type LimitHit } from "./limits.ts";
import { type CycleOverage, overagePerCycle } from "./overage.ts";
import { type Pace, paceOfRunningCycles } from "./pace.ts";
import type { SummaryOptions } from "./summary.ts";
import { deriveWindows, type Reading } from "./window-model.ts";

export interface LimitsOverageAndPace {
  limitHits: readonly LimitHit[];
  overage: readonly CycleOverage[];
  pace: readonly Pace[];
}

/** Limit Hits, Overage per Cycle and Pace from stored Session, Cycle and Overage readings. */
export function limitsOverageAndPace(readings: readonly Reading[], now: string | Date): LimitsOverageAndPace {
  const overage = readings.filter((r) => r.role === "overage");
  const windows = deriveWindows(
    readings.filter((r) => r.role === "session" || r.role === "cycle"),
    now,
  );
  return {
    limitHits: findLimitHits(windows, overage, now),
    overage: overagePerCycle(windows, overage, now),
    pace: paceOfRunningCycles(windows),
  };
}

/** Plain-text Limit Hits, Overage and Pace sections, printed after the Waste summary. */
export function formatLimitsOverageAndPace(data: LimitsOverageAndPace, options: SummaryOptions = {}): string {
  const time = minuteFormatter(options.timeZone);
  const at = (iso: string) => time.format(new Date(iso));

  const hits = table(
    data.limitHits.map((h) => [
      h.provider,
      h.label,
      `hit ${at(h.hitAt)}  blocked ${formatDuration(h.blockedMs)} ${BLOCKED_END[h.endedBy]}`,
    ]),
  );
  const overage = table(
    data.overage.map((o) => [
      o.provider,
      o.cycleLabel,
      o.cycleEndedAt ? `reset ${at(o.cycleEndedAt)}` : "running",
      o.overageLabel,
      formatAmount(o.spent, o.unit),
    ]),
  );
  const pace = table(
    data.pace.map((p) => [p.provider, p.label, p.resetsAt ? `reset ${at(p.resetsAt)}` : "reset unknown", formatPace(p, at)]),
  );

  return [
    "Limit Hits",
    ...(hits.length ? hits : ["  none"]),
    "",
    "Overage",
    ...(overage.length ? overage : ["  none"]),
    "",
    "Pace",
    ...(pace.length ? pace : ["  no running Cycles"]),
  ].join("\n");
}

const BLOCKED_END: Record<LimitHit["endedBy"], string> = {
  reset: "until Reset",
  overage: "until Overage",
  running: "so far",
};

/** Estimated figures are always marked "~" (GLOSSARY: Measured vs Estimated). */
function formatPace(p: Pace, at: (iso: string) => string): string {
  if (p.expectedWaste === null) return "Pace n/a (needs two readings)";
  const marker = p.basis === "estimated" ? "~" : " ";
  const waste = `heading for Waste ${marker}${`${Math.round(p.expectedWaste * 100)}%`.padStart(3)}`;
  return p.projectedLimitHitAt ? `${waste}  limit at ${at(p.projectedLimitHitAt)}` : waste;
}

/** Overage keeps its own unit: dollars or credits, never a share of the allowance. */
function formatAmount(amount: number, unit: string): string {
  if (unit === "$") return `$${amount.toFixed(2)}`;
  return `${Math.round(amount * 100) / 100} ${unit}`;
}

/** Rows as two-space indented, column-aligned lines (the last column is not padded). */
function table(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => r[i]!.length))) ?? [];
  return rows.map((r) => `  ${r.map((cell, i) => (i < r.length - 1 ? cell.padEnd(widths[i]!) : cell)).join("  ")}`);
}

function minuteFormatter(timeZone: string | undefined): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function formatDuration(durationMs: number): string {
  const minutes = Math.round(durationMs / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return [days && `${days}d`, hours && `${hours}h`, mins && `${mins}m`].filter(Boolean).join(" ") || "0m";
}
