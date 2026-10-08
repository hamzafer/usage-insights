import type { Reading, Window } from "./window-model.ts";

/**
 * Limit Hits and Blocked Time (spec §3). Pure functions over Windows from the Window Model.
 */

/** A Window reaching its limit before its Reset (GLOSSARY: Limit Hit). */
export interface LimitHit {
  provider: string;
  label: string;
  role: Window["role"];
  /** The first reading at the limit. */
  hitAt: string;
  /** When Blocked Time ended: the Reset, or the first reading showing Overage growth. Null while still blocked. */
  blockedUntil: string | null;
  /** Blocked Time in ms; while still blocked, the time so far (up to `now`). */
  blockedMs: number;
  /** `reset`: blocked until the Reset. `overage`: the user kept working on paid usage. `running`: still blocked. */
  endedBy: "reset" | "overage" | "running";
}

/**
 * Limit Hits of Session and Cycle Windows, in Window order.
 * `overage` holds the Overage readings (role `overage`) of any Provider; only the same Provider's count.
 */
export function findLimitHits(
  windows: readonly Window[],
  overage: readonly Reading[],
  now: string | Date,
): LimitHit[] {
  const nowMs = typeof now === "string" ? ms(now) : now.getTime();
  const hits: LimitHit[] = [];
  for (const w of windows) {
    if (w.role !== "session" && w.role !== "cycle") continue;
    const hit = w.readings.find((r) => r.limit > 0 && r.used >= r.limit);
    if (!hit) continue;
    const end = blockedEnd(w, hit.fetchedAt, overage);
    hits.push({
      provider: w.provider,
      label: w.label,
      role: w.role,
      hitAt: hit.fetchedAt,
      blockedUntil: end.at,
      blockedMs: Math.max(0, (end.at ? ms(end.at) : nowMs) - ms(hit.fetchedAt)),
      endedBy: end.by,
    });
  }
  return hits;
}

function blockedEnd(
  w: Window,
  hitAt: string,
  overage: readonly Reading[],
): { at: string | null; by: LimitHit["endedBy"] } {
  const growth = overageGrowthAfter(w.provider, hitAt, overage);
  if (growth && (!w.endedAt || ms(growth) < ms(w.endedAt))) return { at: growth, by: "overage" };
  if (w.endedAt) return { at: w.endedAt, by: "reset" };
  return { at: null, by: "running" };
}

/** The first reading after `hitAt` where any of the Provider's Overage lines has grown. */
function overageGrowthAfter(provider: string, hitAt: string, overage: readonly Reading[]): string | null {
  let first: string | null = null;
  for (const line of Map.groupBy(
    overage.filter((r) => r.provider === provider),
    (r) => r.label,
  ).values()) {
    const sorted = line.toSorted((a, b) => ms(a.fetchedAt) - ms(b.fetchedAt));
    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i]!;
      if (ms(cur.fetchedAt) <= ms(hitAt) || cur.used <= sorted[i - 1]!.used) continue;
      if (!first || ms(cur.fetchedAt) < ms(first)) first = cur.fetchedAt;
      break;
    }
  }
  return first;
}

function ms(iso: string): number {
  return Date.parse(iso);
}
