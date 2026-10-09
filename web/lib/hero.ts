import { dateParts } from "./dates";
import { clock, dayMonth, marker, percent } from "./format";
import type { Basis, HeroCycle } from "./types";

/**
 * The hero chart's data, as pure functions (tested in hero.test.ts): rows for Recharts, the
 * x-axis span and ticks, and the rows of the table view.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** One x position of the chart. `used` null breaks the area (a gap); `pace` only on the projection. */
export interface HeroRow {
  t: number;
  /** % used, 0..100+; null inside a gap so the area breaks there instead of dropping to zero. */
  used: number | null;
  /** % used on the Pace projection, from the newest reading to the Reset. */
  pace?: number;
  basis?: Basis;
  /** A reading with gaps on both sides: drawn as a dot, since no line reaches it. */
  alone?: true;
}

/** The row nearest to `t` (the tooltip's crosshair position). */
export function rowAt(rows: readonly HeroRow[], t: number): HeroRow | undefined {
  let best: HeroRow | undefined;
  for (const r of rows) if (!best || Math.abs(r.t - t) < Math.abs(best.t - t)) best = r;
  return best;
}

export function heroRows(hero: HeroCycle): HeroRow[] {
  const rows: HeroRow[] = hero.readings.map((r) => ({ t: Date.parse(r.at), used: r.usedShare * 100, basis: r.basis }));
  for (const gap of hero.gaps) {
    const from = Date.parse(gap.from);
    const to = Date.parse(gap.to);
    // Only a gap with readings on both sides needs a break; before the first or after the last
    // reading the area simply isn't drawn.
    if (rows.some((r) => r.t === from) && rows.some((r) => r.t === to)) rows.push({ t: (from + to) / 2, used: null });
  }
  for (const p of hero.pace?.points ?? []) {
    const t = Date.parse(p.at);
    const same = rows.find((r) => r.t === t && r.used !== null);
    if (same) same.pace = p.usedShare * 100;
    else rows.push({ t, used: null, pace: p.usedShare * 100 });
  }
  const sorted = rows.toSorted((a, b) => a.t - b.t);
  // A reading with a break on both sides draws no line: mark it so the chart gives it a dot.
  const drawn = sorted.filter((r) => r.used !== null || r.pace === undefined);
  drawn.forEach((r, i) => {
    if (r.used !== null && !(drawn[i - 1]?.used != null) && !(drawn[i + 1]?.used != null)) r.alone = true;
  });
  return sorted;
}

/** The x-axis span: the Cycle's start (else its first reading) to its Reset (else its end, else now). */
export function heroDomain(hero: HeroCycle, now: string): [number, number] {
  const first = hero.readings[0] ? Date.parse(hero.readings[0].at) : Date.parse(now);
  const from = hero.start ? Math.min(Date.parse(hero.start), first) : first;
  const last = hero.readings.at(-1) ? Date.parse(hero.readings.at(-1)!.at) : from;
  const end = hero.resetsAt ?? hero.endedAt ?? now;
  return [from, Math.max(Date.parse(end), last, from + HOUR)];
}

const STEPS = [HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];

/**
 * At most `max` ticks on whole local hours or local midnights inside the span, so a weekly Cycle
 * gets one per day and a 5-hour one one per hour.
 */
export function timeTicks([from, to]: [number, number], max = 8): number[] {
  const step = STEPS.find((s) => (to - from) / s <= max) ?? STEPS.at(-1)!;
  const start = new Date(from);
  if (step >= DAY) start.setHours(0, 0, 0, 0);
  else start.setMinutes(0, 0, 0);
  const ticks: number[] = [];
  for (let d = start; d.getTime() <= to; ) {
    if (d.getTime() >= from) ticks.push(d.getTime());
    d = new Date(d);
    if (step >= DAY) d.setDate(d.getDate() + step / DAY);
    else d.setHours(d.getHours() + step / HOUR);
  }
  // Hour steps align to multiples of the step (00:00, 06:00, ...), not to the span's first hour.
  return step < DAY && step > HOUR ? ticks.filter((t) => new Date(t).getHours() % (step / HOUR) === 0) : ticks;
}

/** A tick label: "Tue 7" for day ticks, "14:00" for hour ticks. */
export function tickLabel(t: number, [from, to]: [number, number], timeZone?: string): string {
  if (to - from <= 2 * DAY) return clock(new Date(t).toISOString(), timeZone);
  const p = dateParts(t, timeZone);
  return `${p.weekday} ${p.day}`;
}

/** "Tue 7 Oct, 14:05": the tooltip's and table's time. */
export function longTime(t: number | string, timeZone?: string): string {
  const ms = typeof t === "string" ? Date.parse(t) : t;
  const p = dateParts(ms, timeZone);
  return `${p.weekday} ${p.day} ${p.monthName}, ${p.hour}:${p.minute}`;
}

/** "2d 4h", "5h 10m", "12m"; "now" under a minute. */
export function duration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "now";
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** "1 Oct to 8 Oct": the Cycle's span for the section description. */
export function cycleSpan(hero: HeroCycle, timeZone?: string): string {
  const start = hero.start ?? hero.readings[0]?.at;
  const end = hero.endedAt ?? hero.resetsAt;
  if (!start) return "";
  return end ? `${dayMonth(start, timeZone)} to ${dayMonth(end, timeZone)}` : `Since ${dayMonth(start, timeZone)}`;
}

export interface HeroTableRow {
  at: string;
  /** "Reading", "Estimated reading", "Pace", "Pace: limit reached" or "Pace at the Reset". */
  kind: string;
  used: string;
}

/**
 * The table view: every reading where % used changed (plus the first and the newest, so long flat
 * stretches stay one row), gaps as their own rows, then the Pace projection. Newest first.
 */
export function heroTable(hero: HeroCycle): HeroTableRow[] {
  const rows: HeroTableRow[] = [];
  const readings = hero.readings;
  readings.forEach((r, i) => {
    const changed = i === 0 || i === readings.length - 1 || Math.round(r.usedShare * 100) !== Math.round(readings[i - 1]!.usedShare * 100);
    if (changed) {
      rows.push({
        at: r.at,
        kind: r.basis === "estimated" ? "Estimated reading" : "Reading",
        used: `${marker(r.basis)}${percent(r.usedShare)}`,
      });
    }
  });
  for (const g of hero.gaps) rows.push({ at: g.from, kind: `No readings for ${duration(Date.parse(g.to) - Date.parse(g.from))}`, used: "unknown" });
  const pace = hero.pace;
  if (pace) {
    for (const p of pace.points.slice(1)) {
      const atReset = p === pace.points.at(-1);
      rows.push({
        at: p.at,
        kind: atReset ? "Pace at the Reset" : "Pace: limit reached",
        used: `~${percent(p.usedShare)}`,
      });
    }
  }
  return rows.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
