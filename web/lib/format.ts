import { dateParts } from "./dates";
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
    return dateParts(at, timeZone).weekday;
  }
  return dayMonth(iso, timeZone);
}

/** "12 Oct". */
export function dayMonth(iso: string, timeZone?: string): string {
  const p = dateParts(iso, timeZone);
  return `${p.day} ${p.monthName}`;
}

/** "14:05". */
export function clock(iso: string, timeZone?: string): string {
  const p = dateParts(iso, timeZone);
  return `${p.hour}:${p.minute}`;
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

/** The calendar day of `iso` in `timeZone`, as "2026-10-05": for grouping by day. */
export function dayKey(iso: string, timeZone?: string): string {
  const p = dateParts(iso, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** 950 → "950", 12_300 → "12.3K", 120_400 → "120K", 9_512_000 → "9.5M", 1.25e9 → "1.3B". */
export function compactNumber(n: number): string {
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, unit] of units) {
    if (Math.abs(n) >= size) {
      const v = n / size;
      return `${Math.abs(v) >= 100 ? Math.round(v) : Number(v.toFixed(1))}${unit}`;
    }
  }
  return String(Math.round(n));
}

function sameDay(a: string, b: string, timeZone?: string): boolean {
  return dayKey(a, timeZone) === dayKey(b, timeZone);
}
