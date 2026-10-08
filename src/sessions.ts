import { hasStarted, type Window } from "./window-model.ts";

/**
 * Sessions and Idle Capacity (spec §3). Pure functions over the Window Model's output.
 * Idle Capacity = Cycle time not covered by any started Session.
 */

/** A Session is 5 hours for Claude and Codex (GLOSSARY: Session). */
export const SESSION_LENGTH_MS = 5 * 3_600_000;

export interface IdleCapacity {
  provider: string;
  /** The Cycle this is for; `cycle.endedAt` is null while it is still running. */
  cycle: Window;
  /** The Cycle span looked at: from its start (the previous Reset, else its first reading)... */
  from: string;
  /** ...to its Reset, or `now` while it is running. */
  to: string;
  /** Time within `from`..`to` when no started Session was open. */
  idleMs: number;
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
export function idleCapacity(windows: readonly Window[], now: string | Date): IdleCapacity[] {
  const nowMs = toMs(now);
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
    for (const cycles of Map.groupBy(provWindows.filter((w) => w.role === "cycle"), (w) => w.label).values()) {
      cycles.forEach((cycle, i) => {
        const from = i > 0 && cycles[i - 1]!.endedAt ? ms(cycles[i - 1]!.endedAt!) : ms(cycle.readings[0]!.fetchedAt);
        const to = cycle.endedAt ? ms(cycle.endedAt) : nowMs;
        const length = Math.max(0, to - from);
        const covered = open.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);
        const idleMs = length - covered;
        out.push({ provider, cycle, from: iso(from), to: iso(to), idleMs, share: length > 0 ? idleMs / length : 0 });
      });
    }
  }
  return out;
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
