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

export function deriveWindows(readings: readonly Reading[], now: string | Date): Window[] {
  void now;
  const windows: Window[] = [];
  for (const line of groupByLine(readings)) windows.push(...windowsOfLine(line));
  return windows;
}

function groupByLine(readings: readonly Reading[]): Reading[][] {
  const lines = new Map<string, Reading[]>();
  for (const r of readings) {
    const key = `${r.provider}\u0000${r.label}`;
    const line = lines.get(key);
    if (line) line.push(r);
    else lines.set(key, [r]);
  }
  return [...lines.values()].map((line) => line.toSorted((a, b) => ms(a.fetchedAt) - ms(b.fetchedAt)));
}

function windowsOfLine(line: Reading[]): Window[] {
  const groups: Reading[][] = [];
  let current: Reading[] = [];
  for (const r of line) {
    const last = current.at(-1);
    if (last && last.resetsAt && r.resetsAt && ms(r.resetsAt) - ms(last.resetsAt) > RESET_TOLERANCE_MS) {
      groups.push(current);
      current = [];
    }
    current.push(r);
  }
  if (current.length) groups.push(current);

  return groups.map((group, i) => {
    const first = group[0]!;
    const last = group.at(-1)!;
    const ended = i < groups.length - 1;
    const known = group.find((r) => r.resetsAt)?.resetsAt;
    const resetsAt = known ? roundToMinute(known) : null;
    const endedAt = ended ? resetsAt : null;
    return {
      provider: first.provider,
      label: first.label,
      role: first.role,
      resetsAt,
      readings: group,
      endedAt,
      waste: endedAt
        ? {
            share: (last.limit - last.used) / last.limit,
            lastReadingAt: last.fetchedAt,
            lowConfidence: ms(endedAt) - ms(last.fetchedAt) > LOW_CONFIDENCE_GAP_MS,
            basis: "measured",
          }
        : null,
    };
  });
}

/** A last reading older than this before the Reset makes its Waste low confidence. */
export const LOW_CONFIDENCE_GAP_MS = 30 * 60_000;

/** Reported reset times within this of each other are the same Reset (jitter and drift). */
const RESET_TOLERANCE_MS = 5 * 60_000;

function roundToMinute(iso: string): string {
  return new Date(Math.round(ms(iso) / 60_000) * 60_000).toISOString();
}

function ms(iso: string): number {
  return Date.parse(iso);
}
