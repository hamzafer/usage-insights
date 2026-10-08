import { projectName } from "./projects.ts";
import type { TokenEvent } from "./store.ts";
import type { Window } from "./window-model.ts";

/**
 * Token share per Project and per model (spec §4-5, ticket #7). Pure functions, no I/O.
 * Tokens are counted as logged (input, cache writes, cache reads and output together), never
 * converted, so these shares are exact; they are not shares of the allowance.
 */

export interface Share {
  /** A Project's folder name ("(other)" when unresolvable) or a model id. */
  name: string;
  tokens: number;
  /** Of the total, 0..1. */
  share: number;
}

export interface TokenShares {
  total: number;
  /** Largest first, ties by name. */
  byProject: Share[];
  byModel: Share[];
}

/** One Cycle of one Provider, as a time span. */
export interface CycleSpan {
  provider: string;
  label: string;
  /** Inclusive start (the previous Reset). */
  from: string;
  /** Exclusive end (the Reset). */
  to: string;
  running: boolean;
  /**
   * True when either end was not recorded but stepped in Cycle lengths from a recorded Reset
   * (before Snapshots started, across gaps), or assumed (Monday 00:00 UTC) when none was recorded.
   */
  inferred: boolean;
}

export interface CycleTokens extends CycleSpan, TokenShares {}

export const CYCLE_MS = 7 * 24 * 3_600_000;
const DEFAULT_CYCLE_LABEL = "Weekly";
/** Recorded Resets closer than this to a stepped one replace it (jitter, early Resets). */
const STEP_TOLERANCE_MS = 24 * 3_600_000;

export function tokenTotal(e: TokenEvent): number {
  return e.input + e.cacheWrite + e.cacheRead + e.output;
}

/**
 * A Provider's Cycles from `earliest` (the first tokens) through `now`: recorded Resets of its
 * Cycle line, stepped by a Cycle length back to `earliest`, forward past `now`, and across gaps.
 */
export function tokenCycles(provider: string, windows: readonly Window[], earliest: string, now: string | Date): CycleSpan[] {
  const nowMs = toMs(now);
  const cycles = windows.filter((w) => w.provider === provider && w.role === "cycle");
  const label = cycles.map((w) => w.label).toSorted()[0] ?? DEFAULT_CYCLE_LABEL;
  const line = cycles.filter((w) => w.label === label);
  const recorded = [
    ...new Set(
      line.flatMap((w) => [w.endedAt, w.endedAt ? null : w.resetsAt]).filter((t): t is string => t !== null).map(toMs),
    ),
  ].toSorted((a, b) => a - b);
  if (recorded.length === 0) recorded.push(nextMondayUtc(nowMs));

  const known = new Set(cycles.length ? recorded : []);
  const bounds = [recorded[0]!];
  for (const b of recorded.slice(1)) {
    // Step back from each recorded Reset to fill a gap longer than one Cycle.
    const filled: number[] = [];
    for (let t = b - CYCLE_MS; t - bounds.at(-1)! > STEP_TOLERANCE_MS; t -= CYCLE_MS) filled.unshift(t);
    bounds.push(...filled, b);
  }
  const first = Math.min(toMs(earliest), nowMs);
  while (bounds[0]! > first) bounds.unshift(bounds[0]! - CYCLE_MS);
  while (bounds.at(-1)! <= nowMs) bounds.push(bounds.at(-1)! + CYCLE_MS);

  return bounds.slice(1).map((to, i) => {
    const from = bounds[i]!;
    return {
      provider,
      label,
      from: iso(from),
      to: iso(to),
      running: from <= nowMs && nowMs < to,
      inferred: !known.has(from) || !known.has(to),
    };
  });
}

/**
 * Token share per Project and model for every Cycle of every Provider that has tokens in it,
 * per Provider, oldest Cycle first. `windows` are the Window Model's (Cycles define the spans).
 */
export function tokensByCycle(events: readonly TokenEvent[], windows: readonly Window[], now: string | Date): CycleTokens[] {
  const byProvider = Map.groupBy(events, (e) => e.provider);
  return [...byProvider.keys()].toSorted().flatMap((provider) => {
    const own = byProvider.get(provider)!;
    const earliest = iso(Math.min(...own.map((e) => toMs(e.at))));
    return tokenCycles(provider, windows, earliest, now).flatMap((span) => {
      const from = toMs(span.from);
      const to = toMs(span.to);
      const inside = own.filter((e) => toMs(e.at) >= from && toMs(e.at) < to);
      const shares = sharesOf(inside);
      return shares.total > 0 ? [{ ...span, ...shares }] : [];
    });
  });
}

export interface PeriodOptions {
  /** Inclusive. */
  from: string;
  /** Exclusive. */
  to: string;
  /** Only these Providers; all when omitted. */
  providers?: readonly string[];
  /** Keep the largest `limit` Projects and models (shares stay of the full total). */
  limit?: number;
}

/** The top Projects and models for a period (e.g. a Report's week), across Providers unless filtered. */
export function topUsage(events: readonly TokenEvent[], o: PeriodOptions): TokenShares {
  const from = toMs(o.from);
  const to = toMs(o.to);
  const shares = sharesOf(
    events.filter((e) => toMs(e.at) >= from && toMs(e.at) < to && (!o.providers || o.providers.includes(e.provider))),
  );
  if (o.limit === undefined) return shares;
  return { ...shares, byProject: shares.byProject.slice(0, o.limit), byModel: shares.byModel.slice(0, o.limit) };
}

function sharesOf(events: readonly TokenEvent[]): TokenShares {
  const total = events.reduce((sum, e) => sum + tokenTotal(e), 0);
  const rank = (key: (e: TokenEvent) => string): Share[] => {
    const sums = new Map<string, number>();
    for (const e of events) sums.set(key(e), (sums.get(key(e)) ?? 0) + tokenTotal(e));
    return [...sums]
      .map(([name, tokens]) => ({ name, tokens, share: total > 0 ? tokens / total : 0 }))
      .toSorted((a, b) => b.tokens - a.tokens || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  };
  return { total, byProject: rank((e) => projectName(e.project)), byModel: rank((e) => e.model) };
}

function nextMondayUtc(nowMs: number): number {
  const d = new Date(nowMs);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const daysToMonday = (8 - d.getUTCDay()) % 7 || 7;
  return midnight + daysToMonday * 24 * 3_600_000;
}

function toMs(t: string | Date): number {
  return typeof t === "string" ? Date.parse(t) : t.getTime();
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
