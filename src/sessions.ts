import { hasStarted, type Window } from "./window-model.ts";

/**
 * Sessions and Idle Capacity (spec §3). Pure functions over the Window Model's output.
 * Idle Capacity = Cycle time not covered by any started Session, counting only time the readings
 * cover: a stretch with no readings is unknown, not idle (ADR 0001), and is reported apart.
 */

/** A Session is 5 hours for Claude and Codex (GLOSSARY: Session). */
export const SESSION_LENGTH_MS = 5 * 3_600_000;

/**
 * Two readings of a Provider at most this far apart cover the time between them. The recorder
 * takes one every 5 minutes; this leaves room for a late or skipped run.
 */
export const READING_GAP_TOLERANCE_MS = 15 * 60_000;

/** A recording run that got no Snapshot (the store's gap marker). */
export interface GapMarker {
  recordedAt: string;
}

export interface IdleCapacityOptions {
  /** Recorder gap markers: the stretch around each is unknown even between close readings. */
  gaps?: readonly GapMarker[];
}

export interface IdleCapacity {
  provider: string;
  /** The Cycle this is for; `cycle.endedAt` is null while it is still running. */
  cycle: Window;
  /** The Cycle span looked at: from its start (the previous Reset, else its first reading)... */
  from: string;
  /** ...to its Reset, or `now` while it is running. */
  to: string;
  /** Time within `from`..`to` the readings cover and no started Session was open. */
  idleMs: number;
  /** Time within `from`..`to` with no readings and no started Session: gaps, not Idle Capacity. */
  unknownMs: number;
  /** `idleMs` as a share of the span, 0..1. */
  share: number;
}

/** When a started Session was open; null for a Session that never started. */
export function sessionSpan(session: Window, now: string | Date): { from: string; to: string } | null {
  if (!hasStarted(session.readings)) return null;
  const nowMs = toMs(now);
  const firstUse = session.readings.find((r) => r.used > 0 || r.resetsAt !== null)!;
  // The reported Reset is exact; readings are sparse, so the first one can come long after the start.
  const from = session.resetsAt ? ms(session.resetsAt) - SESSION_LENGTH_MS : ms(firstUse.fetchedAt);
  const to = session.endedAt ? ms(session.endedAt) : Math.min(session.resetsAt ? ms(session.resetsAt) : nowMs, nowMs);
  return { from: iso(Math.min(from, to)), to: iso(to) };
}

/**
 * Idle Capacity per Cycle, for every Provider that has Sessions, in the order the Cycles come.
 * `windows` is `deriveWindows` output holding both the Cycles and the Sessions.
 */
export function idleCapacity(
  windows: readonly Window[],
  now: string | Date,
  options: IdleCapacityOptions = {},
): IdleCapacity[] {
  const nowMs = toMs(now);
  const gaps = (options.gaps ?? []).map((g) => ms(g.recordedAt));
  const out: IdleCapacity[] = [];
  const byProvider = Map.groupBy(windows, (w) => w.provider);
  for (const [provider, provWindows] of byProvider) {
    const sessions = provWindows.filter((w) => w.role === "session");
    if (sessions.length === 0) continue;
    const open = mergeSpans(
      sessions.flatMap((s) => {
        const span = sessionSpan(s, now);
        return span ? [[ms(span.from), ms(span.to)] as [number, number]] : [];
      }),
    );
    // A started Session's span is known even where no reading was taken.
    const known = mergeSpans([...readingSpans(provWindows, gaps), ...open]);
    for (const cycles of Map.groupBy(provWindows.filter((w) => w.role === "cycle"), (w) => w.label).values()) {
      cycles.forEach((cycle, i) => {
        const from = i > 0 && cycles[i - 1]!.endedAt ? ms(cycles[i - 1]!.endedAt!) : ms(cycle.readings[0]!.fetchedAt);
        const to = cycle.endedAt ? ms(cycle.endedAt) : nowMs;
        const length = Math.max(0, to - from);
        const unknownMs = length - overlap(known, from, to);
        const idleMs = length - overlap(open, from, to) - unknownMs;
        out.push({
          provider,
          cycle,
          from: iso(from),
          to: iso(to),
          idleMs,
          unknownMs,
          share: length > 0 ? idleMs / length : 0,
        });
      });
    }
  }
  return out;
}

/**
 * Spans the readings cover: between consecutive readings at most `READING_GAP_TOLERANCE_MS`
 * apart, unless a recorder gap marker falls between them.
 */
function readingSpans(windows: readonly Window[], gaps: number[]): [number, number][] {
  const times = [...new Set(windows.flatMap((w) => w.readings.map((r) => ms(r.fetchedAt))))].toSorted((a, b) => a - b);
  const spans: [number, number][] = [];
  for (let i = 1; i < times.length; i++) {
    const a = times[i - 1]!;
    const b = times[i]!;
    if (b - a <= READING_GAP_TOLERANCE_MS && !gaps.some((g) => g > a && g < b)) spans.push([a, b]);
  }
  return spans;
}

/** Total length of sorted, non-overlapping `spans` within `from`..`to`. */
function overlap(spans: [number, number][], from: number, to: number): number {
  return spans.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);
}

/** Sorted, non-overlapping spans. */
function mergeSpans(spans: [number, number][]): [number, number][] {
  const merged: [number, number][] = [];
  for (const [a, b] of spans.toSorted((x, y) => x[0] - y[0])) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

function toMs(t: string | Date): number {
  return typeof t === "string" ? ms(t) : t.getTime();
}

function ms(iso: string): number {
  return Date.parse(iso);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
