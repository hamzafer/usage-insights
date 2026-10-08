import type { LineRole } from "./classify.ts";

/**
 * Window Model (spec §3): turns stored readings into Windows and their results.
 * Pure functions only, no I/O. Readings may be sparse and irregular.
 */

/** One reading of one line, from a Snapshot or a Backfill (`source`). */
export interface Reading {
  provider: string;
  label: string;
  role: LineRole;
  used: number;
  limit: number;
  /** As reported: may carry millisecond jitter or drift by seconds. */
  resetsAt: string | null;
  fetchedAt: string;
  /** `openusage`, `backfill:codex`, `backfill:claude`, ... */
  source: string;
}

/** Measured comes from a Snapshot or a log that records the limit; Estimated is converted from tokens. */
export type Basis = "measured" | "estimated";

export interface Waste {
  /** Unused share of the allowance at the Reset, 0..1. */
  share: number;
  /** The reading the share comes from: the last one before the Reset. */
  lastReadingAt: string;
  /** True when that reading is more than 30 minutes before the Reset. */
  lowConfidence: boolean;
  basis: Basis;
}

/** One Window of one line (provider + label). */
export interface Window {
  provider: string;
  label: string;
  role: LineRole;
  /** The Window's Reset as reported, rounded to the minute. Null while unknown. */
  resetsAt: string | null;
  /** This Window's readings, oldest first. */
  readings: Reading[];
  /** When the Window ended (its Reset), or null while it is still running. */
  endedAt: string | null;
  /** Waste at the Reset; null while running or when it cannot be measured. */
  waste: Waste | null;
}

/**
 * Splits readings into Windows per line (provider + label), sorted by provider, label, then time.
 * A Window has ended once a later Window was seen or its Reset is at or before `now`.
 */
export function deriveWindows(readings: readonly Reading[], now: string | Date): Window[] {
  const nowMs = typeof now === "string" ? ms(now) : now.getTime();
  return groupByLine(readings).flatMap((line) => windowsOfLine(line, nowMs));
}

function groupByLine(readings: readonly Reading[]): Reading[][] {
  const lines = new Map<string, Reading[]>();
  for (const r of readings) {
    const key = `${r.provider}\u0000${r.label}`;
    const line = lines.get(key);
    if (line) line.push(r);
    else lines.set(key, [r]);
  }
  return [...lines.values()]
    .toSorted((a, b) => compare(a[0]!.provider, b[0]!.provider) || compare(a[0]!.label, b[0]!.label))
    .map((line) => line.toSorted((a, b) => ms(a.fetchedAt) - ms(b.fetchedAt)));
}

function windowsOfLine(line: Reading[], nowMs: number): Window[] {
  const groups: Reading[][] = [];
  let current: Reading[] = [];
  for (const r of line) {
    if (current.length && startsNewWindow(current, r)) {
      groups.push(current);
      current = [];
    }
    current.push(r);
  }
  if (current.length) groups.push(current);

  return groups.map((group, i) => {
    const first = group[0]!;
    const resetsAt = knownReset(group);
    const next = groups[i + 1]?.[0];
    const endedAt = next
      ? resetMoment(resetsAt, next)
      : resetsAt && ms(resetsAt) <= nowMs
        ? resetsAt
        : null;
    return {
      provider: first.provider,
      label: first.label,
      role: first.role,
      resetsAt,
      readings: group,
      endedAt,
      waste: endedAt ? wasteAt(group, endedAt) : null,
    };
  });
}

/** A Reset lies between the Window's readings so far and `r`. */
function startsNewWindow(window: Reading[], r: Reading): boolean {
  const last = window.at(-1)!;
  const reset = knownReset(window);
  if (reset && r.resetsAt && ms(r.resetsAt) - ms(reset) > RESET_TOLERANCE_MS) return true;
  // Fetched after the Reset: a new Window, unless the reading still reports the old Reset (stale).
  const reportsSameReset = r.resetsAt && Math.abs(ms(r.resetsAt) - ms(reset ?? r.resetsAt)) <= RESET_TOLERANCE_MS;
  if (reset && !reportsSameReset && ms(r.fetchedAt) - ms(reset) > RESET_TOLERANCE_MS) return true;
  const before = share(last);
  const after = share(r);
  return after <= NEAR_ZERO_SHARE && before - after >= MIN_RESET_DROP;
}

/**
 * When a Window ended: its reported Reset, unless the next Window's first reading came earlier
 * (an early Reset, or none reported), which then bounds it.
 */
function resetMoment(resetsAt: string | null, next: Reading): string {
  if (resetsAt && ms(resetsAt) <= ms(next.fetchedAt)) return resetsAt;
  return next.fetchedAt;
}

/** Waste from the last reading at or before the Reset (a stale one fetched after it doesn't count). */
function wasteAt(window: Reading[], endedAt: string): Waste | null {
  const last = window.findLast((r) => ms(r.fetchedAt) <= ms(endedAt)) ?? window[0]!;
  if (last.limit <= 0) return null;
  return {
    share: (last.limit - last.used) / last.limit,
    lastReadingAt: last.fetchedAt,
    lowConfidence: ms(endedAt) - ms(last.fetchedAt) > LOW_CONFIDENCE_GAP_MS,
    basis: last.source.startsWith("backfill:claude") ? "estimated" : "measured",
  };
}

/** The Window's Reset, rounded to the minute: the first one any of its readings reported. */
function knownReset(window: Reading[]): string | null {
  const reported = window.find((r) => r.resetsAt)?.resetsAt;
  return reported ? roundToMinute(reported) : null;
}

function share(r: Reading): number {
  return r.limit > 0 ? r.used / r.limit : 0;
}

/** Usage at or below this share counts as "back near zero". */
const NEAR_ZERO_SHARE = 0.01;
/** ...but only after a drop of at least this share, so small dips are not Resets. */
const MIN_RESET_DROP = 0.05;

/** A last reading older than this before the Reset makes its Waste low confidence. */
export const LOW_CONFIDENCE_GAP_MS = 30 * 60_000;

/** Reported reset times within this of each other are the same Reset (jitter and drift). */
const RESET_TOLERANCE_MS = 5 * 60_000;

function roundToMinute(iso: string): string {
  return new Date(Math.round(ms(iso) / 60_000) * 60_000).toISOString();
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function ms(iso: string): number {
  return Date.parse(iso);
}
