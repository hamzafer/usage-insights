import type { Basis, Pace } from "./types";

/**
 * Formatting shared by every section: pure functions, tested with `bun test` (format.test.ts).
 * Times use 24-hour clocks; `timeZone` defaults to the browser's.
 */

const DAY_MS = 24 * 3_600_000;

/** 0.427 → "43%". */
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** "~" for an Estimated number (GLOSSARY: Measured vs Estimated), else "". */
export function marker(basis: Basis): string {
  return basis === "estimated" ? "~" : "";
}

/** "Tue" within the coming 6 days (or "today"), else "12 Oct". */
export function weekdayOrDate(iso: string, now: string, timeZone?: string): string {
  const at = Date.parse(iso);
  if (sameDay(iso, now, timeZone)) return "today";
  if (at - Date.parse(now) < 6 * DAY_MS && at >= Date.parse(now)) {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone }).format(at);
  }
  return dayMonth(iso, timeZone);
}

/** "12 Oct". */
export function dayMonth(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(Date.parse(iso));
}

/** "14:05". */
export function clock(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(
    Date.parse(iso),
  );
}

/** "Resets Tue 14:00" within the week, "Resets 12 Oct" later, "No Reset reported" without one. */
export function resetText(resetsAt: string | null, now: string, timeZone?: string): string {
  if (!resetsAt) return "No Reset reported";
  const day = weekdayOrDate(resetsAt, now, timeZone);
  const soon = Date.parse(resetsAt) - Date.parse(now) < 6 * DAY_MS;
  return soon ? `Resets ${day} ${clock(resetsAt, timeZone)}` : `Resets ${day}`;
}

/**
 * The short Pace line of a plan tile: where the running Cycle is heading at its Reset.
 * "Untouched", "Max out Tue", "~43% waste ahead", or "Needs more readings" (no rate yet).
 */
export function paceText(pace: Pace, now: string, timeZone?: string): string {
  if (pace.usedShare === 0) return "Untouched";
  if (pace.projectedLimitHitAt) return `Max out ${weekdayOrDate(pace.projectedLimitHitAt, now, timeZone)}`;
  if (pace.expectedWaste === null) return "Needs more readings";
  if (pace.expectedWaste < 0.005) return "Full use ahead";
  return `~${percent(pace.expectedWaste)} waste ahead`;
}

export interface Delta {
  /** Rounded percentage points, signed. */
  points: number;
  direction: "up" | "down" | "flat";
  /** "+12 pts", "−3 pts", "±0 pts"; "~" in front when the last Cycle is Estimated. */
  text: string;
}

/** The change in % used vs the last Cycle at the same point, in percentage points. */
export function deltaPoints(current: number, previous: number, basis: Basis = "measured"): Delta {
  const points = Math.round(current * 100) - Math.round(previous * 100);
  const direction = points > 0 ? "up" : points < 0 ? "down" : "flat";
  const sign = points > 0 ? "+" : points < 0 ? "−" : "±";
  return { points, direction, text: `${marker(basis)}${sign}${Math.abs(points)} pts` };
}

function sameDay(a: string, b: string, timeZone?: string): boolean {
  const f = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  return f.format(Date.parse(a)) === f.format(Date.parse(b));
}
