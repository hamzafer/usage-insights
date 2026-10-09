import { type Pace, paceOfRunningCycles } from "../pace.ts";
import { basisOfSource } from "../providers.ts";
import { type Basis, deriveWindows, type Window } from "../window-model.ts";
import { type DashboardData, SNAPSHOT_GAP_MS, type Span } from "./view-model.ts";

/**
 * The Overview's hero chart (`GET /api/hero/:provider`): one plan's current Cycle as a series of
 * % used, the Pace projection from the newest reading to the Reset, and the stretches without
 * readings (shown as breaks, never as zero). Pure: no I/O, no HTML.
 */

export interface HeroPoint {
  at: string;
  /** Share of the allowance used, 0..1 (may pass 1 past a Limit Hit). */
  usedShare: number;
  basis: Basis;
}

export interface HeroPace {
  /** The line to draw: the newest reading, the projected Limit Hit (if before the Reset), the Reset. */
  points: { at: string; usedShare: number }[];
  /** Projected share used at the Reset, 0..1. */
  projectedShare: number;
  expectedWaste: number;
  projectedLimitHitAt: string | null;
  basis: Basis;
}

export interface HeroCycle {
  provider: string;
  label: string;
  /** Every Cycle line this Provider has, for picking another (`?label=`). */
  labels: string[];
  /** False when the line's newest Cycle has ended and no new one was recorded yet. */
  running: boolean;
  /** The Cycle's start (the previous Reset); null while unknown. */
  start: string | null;
  /** The Reset as reported; null while unknown. */
  resetsAt: string | null;
  /** When the Cycle ended; null while running. */
  endedAt: string | null;
  /** The limit as a share: always 1 (100%). */
  limitShare: 1;
  readings: HeroPoint[];
  /** Null while ended, or while Pace has no rate yet. */
  pace: HeroPace | null;
  /** Stretches of the Cycle without readings: from its start, between readings, and up to now. */
  gaps: Span[];
}

/**
 * The hero data for one Provider's Cycle line: `label` when given, else its first running Cycle
 * line, else the line whose Cycle ended last. Null when the Provider (or that line) has no Cycles.
 */
export function buildHero(data: DashboardData, provider: string, now: string | Date, label?: string): HeroCycle | null {
  const nowMs = toMs(now);
  const windows = deriveWindows(
    data.readings.filter((r) => r.provider === provider && r.role === "cycle"),
    now,
  );
  if (windows.length === 0) return null;
  const labels = [...new Set(windows.map((w) => w.label))];
  const newestPerLine = labels.map((l) => windows.findLast((w) => w.label === l)!);
  const current =
    label !== undefined
      ? newestPerLine.find((w) => w.label === label)
      : (newestPerLine.find((w) => !w.endedAt) ??
        newestPerLine.toSorted((a, b) => toMs(b.endedAt!) - toMs(a.endedAt!))[0]);
  if (!current) return null;

  const i = windows.indexOf(current);
  const previous = windows[i - 1]?.label === current.label ? windows[i - 1] : undefined;
  const start = cycleStart(current, previous);
  const pace = current.endedAt ? null : paceOfRunningCycles(windows).find((p) => p.label === current.label);
  const readings = current.readings
    .filter((r) => r.limit > 0)
    .map((r) => ({ at: r.fetchedAt, usedShare: r.used / r.limit, basis: basisOfSource(r.source) }));

  return {
    provider,
    label: current.label,
    labels,
    running: !current.endedAt,
    start: start === null ? null : iso(start),
    resetsAt: current.resetsAt,
    endedAt: current.endedAt,
    limitShare: 1,
    readings,
    pace: pace ? heroPace(pace) : null,
    gaps: readingGaps(
      readings.map((r) => toMs(r.at)),
      start,
      current.endedAt ? toMs(current.endedAt) : nowMs,
    ),
  };
}

/** The Cycle's start, as Pace anchors it: the later of Reset − length and the previous Window's end. */
function cycleStart(w: Window, previous: Window | undefined): number | null {
  const periodMs = w.readings.findLast((r) => r.periodMs)?.periodMs;
  const starts = [
    periodMs && w.resetsAt ? toMs(w.resetsAt) - periodMs : null,
    previous?.endedAt ? toMs(previous.endedAt) : null,
  ].filter((t): t is number => t !== null);
  return starts.length ? Math.max(...starts) : null;
}

function heroPace(p: Pace): HeroPace | null {
  if (p.projectedShare === null || p.expectedWaste === null || !p.resetsAt) return null;
  const points = [{ at: p.lastReadingAt, usedShare: p.usedShare }];
  if (p.projectedLimitHitAt) points.push({ at: p.projectedLimitHitAt, usedShare: 1 });
  points.push({ at: p.resetsAt, usedShare: p.projectedShare });
  return {
    points,
    projectedShare: p.projectedShare,
    expectedWaste: p.expectedWaste,
    projectedLimitHitAt: p.projectedLimitHitAt,
    basis: p.basis,
  };
}

/** Stretches longer than SNAPSHOT_GAP_MS without a reading, between `from` (when known) and `to`. */
function readingGaps(times: number[], from: number | null, to: number): Span[] {
  const marks = [...(from !== null && from < (times[0] ?? to) ? [from] : []), ...times, Math.max(to, times.at(-1) ?? to)];
  const gaps: Span[] = [];
  for (let i = 1; i < marks.length; i++) {
    if (marks[i]! - marks[i - 1]! > SNAPSHOT_GAP_MS) gaps.push({ from: iso(marks[i - 1]!), to: iso(marks[i]!) });
  }
  return gaps;
}

function toMs(t: string | Date): number {
  return typeof t === "string" ? Date.parse(t) : t.getTime();
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
