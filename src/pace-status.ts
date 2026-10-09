import type { Pace } from "./pace.ts";

/**
 * The status of a running Cycle from its Pace: one rule for every surface that shows a status dot
 * (the Telegram card, the dashboard's plan tiles). Pure, no I/O.
 */

export type Status = "red" | "yellow" | "green" | "unknown";

/** Waste ahead below this is green, above `WASTE_RED` red, in between yellow. */
export const WASTE_GREEN = 0.3;
export const WASTE_RED = 0.7;
/**
 * A projected Limit Hit is judged by the time it would leave the user blocked (Reset minus the hit)
 * as a share of the Cycle: maxing out in the last 10% of the Cycle uses the allowance fully (green),
 * up to 30% is a warning (yellow), more is red.
 */
export const BLOCKED_GREEN = 0.1;
export const BLOCKED_RED = 0.3;

/** The Cycle length assumed when a Pace has no reported period. */
const DEFAULT_CYCLE_MS = 7 * 24 * 3_600_000;

/**
 * Status dot of a running Cycle (README: "Status dots"):
 * - no rate yet: unknown;
 * - a Limit Hit projected before the Reset: by the share of the Cycle left blocked
 *   (≤ 10% green, ≤ 30% yellow, more red); a near Limit Hit is a warning, a late one is fine;
 * - otherwise by the Waste it is heading for: < 30% green, 30–70% yellow, > 70% red.
 *
 * `score` orders rows of the same status, worst first.
 */
export function paceStatus(p: Pace): { status: Status; score: number } {
  if (p.projectedLimitHitAt && p.resetsAt) {
    const blocked = blockedShare(p);
    // Within a color, a projected Limit Hit sorts before Waste.
    return { status: blocked <= BLOCKED_GREEN ? "green" : blocked <= BLOCKED_RED ? "yellow" : "red", score: 1 + blocked };
  }
  if (p.expectedWaste === null) return { status: "unknown", score: 0 };
  const w = p.expectedWaste;
  return { status: w < WASTE_GREEN ? "green" : w <= WASTE_RED ? "yellow" : "red", score: w };
}

function blockedShare(p: Pace): number {
  const length = p.periodMs ?? DEFAULT_CYCLE_MS;
  return Math.max(0, Date.parse(p.resetsAt!) - Date.parse(p.projectedLimitHitAt!)) / length;
}
