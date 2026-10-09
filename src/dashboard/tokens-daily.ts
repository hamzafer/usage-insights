import { modelName } from "../names.ts";
import type { TokenEvent } from "../store.ts";
import { tokenTotal } from "../token-shares.ts";

/**
 * Tokens per local day per Provider per model (ticket #19, `GET /api/tokens/daily?range=`).
 * Pure, no I/O. Tokens are counted as logged (input, cache writes, cache reads and output), as
 * everywhere else. Every day of the range is listed: tokens come from logs, so a day without
 * events really had 0 tokens (unlike a gap in readings).
 */

export const TOKEN_RANGES = { "7d": 7, "30d": 30 } as const;
export type TokenRange = keyof typeof TOKEN_RANGES;

export function isTokenRange(value: string | null): value is TokenRange {
  return value !== null && Object.hasOwn(TOKEN_RANGES, value);
}

export interface TokensDay {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Tokens per Provider, then per model id; absent when 0. */
  byProvider: Record<string, Record<string, number>>;
}

export interface TokensDaily {
  range: TokenRange;
  /** Oldest first, today last; every day of the range, including days without tokens. */
  days: TokensDay[];
  /**
   * Every model id with tokens in the widest range (30 days), largest first, ties by id: a stable
   * order for colors, so a model keeps its color when the range or the Provider filter changes.
   */
  models: { id: string; name: string }[];
  /** Providers with tokens in the widest range, by id. */
  providers: string[];
}

const DAY_MS = 24 * 3_600_000;
const WIDEST = Math.max(...Object.values(TOKEN_RANGES));

/**
 * The oldest token row buildTokensDaily can use (the widest range, plus slack for time zones), so
 * the server reads only those rows.
 */
export function tokensDailyFrom(now: string | Date): string {
  return new Date(new Date(now).getTime() - (WIDEST + 3) * DAY_MS).toISOString();
}

export function buildTokensDaily(
  events: readonly TokenEvent[],
  range: TokenRange,
  now: string | Date,
  timeZone?: string,
): TokensDaily {
  const dayOf = localDay(timeZone);
  const today = dayOf(new Date(now).getTime());
  const widest = lastDays(today, WIDEST);
  const shown = new Set(lastDays(today, TOKEN_RANGES[range]));
  const inWidest = new Set(widest);
  // A day is at most 26 hours from UTC midnight; anything older than that cannot land in range.
  const earliest = Date.parse(`${widest[0]}T00:00:00Z`) - 2 * DAY_MS;

  const days = new Map(widest.filter((d) => shown.has(d)).map((d) => [d, {} as Record<string, Record<string, number>>]));
  const modelTotals = new Map<string, number>();
  const providers = new Set<string>();
  for (const e of events) {
    const at = Date.parse(e.at);
    if (!(at >= earliest)) continue;
    const day = dayOf(at);
    if (!inWidest.has(day)) continue;
    const tokens = tokenTotal(e);
    if (tokens <= 0) continue;
    modelTotals.set(e.model, (modelTotals.get(e.model) ?? 0) + tokens);
    providers.add(e.provider);
    const bucket = days.get(day);
    if (!bucket) continue;
    const own = (bucket[e.provider] ??= {});
    own[e.model] = (own[e.model] ?? 0) + tokens;
  }

  return {
    range,
    days: [...days].map(([date, byProvider]) => ({ date, byProvider })),
    models: [...modelTotals]
      .toSorted(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
      .map(([id]) => ({ id, name: modelName(id) })),
    providers: [...providers].toSorted(),
  };
}

/** `YYYY-MM-DD` of a time in `timeZone` (local when omitted). */
function localDay(timeZone?: string): (ms: number) => string {
  const f = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  return (ms) => {
    const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
}

/** The `count` calendar days ending with `today`, oldest first (calendar math, so DST cannot skip a day). */
function lastDays(today: string, count: number): string[] {
  const base = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(base - (count - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}
