import { modelName } from "../names.ts";
import type { ApiSpendRow } from "../store.ts";

/**
 * API Spend per Key for the Overview's "Claude API" section (`GET /api/api-spend`, spec: Showing it).
 * Pure, no I/O. Rows carry a local `day` already (written by the Callers), so days are compared as
 * strings; `timeZone` only decides which day is today.
 *
 * Unknown prices (a null `costUsd`) are never read as zero: a sum is `costUsd: null` when every
 * row in it has an unknown price, and `partial: true` when only some do (`costUsd` then holds the
 * known part, a lower bound). A sum with no rows is `costUsd: 0`, because no calls means no spend.
 */

/** Keys listed even without rows (the two Keychain items of ADR 0004). */
export const ALWAYS_KEYS = ["personal", "work"] as const;
export const SPEND_DAYS = 30;
const WEEK_DAYS = 7;
const DAY_MS = 24 * 3_600_000;

export interface Spend {
  costUsd: number | null;
  calls: number;
  /** Some, but not all, of the rows have an unknown price: `costUsd` is then only what is known. */
  partial: boolean;
}

export interface CallerSpend {
  caller: string;
  model: string;
  /** Display name ("Haiku 4.5"); the raw id when unknown. */
  modelName: string;
  last7d: Spend;
  last30d: Spend;
}

export interface KeySpend {
  key: string;
  last7d: Spend;
  last30d: Spend;
  /** Largest 30-day cost first (unknown last), then by caller and model. */
  callers: CallerSpend[];
  /** Oldest first, today last; every one of the 30 days, 0 where there are no rows. */
  daily: { day: string; costUsd: number | null; partial: boolean }[];
}

export interface ApiSpend {
  keys: KeySpend[];
}

/** The oldest `day` buildApiSpend can use (the 30 days, plus slack for time zones). */
export function apiSpendFrom(now: string | Date, timeZone?: string): string {
  return lastDays(localDay(timeZone)(new Date(now).getTime()), SPEND_DAYS + 2)[0]!;
}

export function buildApiSpend(rows: readonly ApiSpendRow[], now: string | Date, timeZone?: string): ApiSpend {
  const days = lastDays(localDay(timeZone)(new Date(now).getTime()), SPEND_DAYS);
  const inWeek = new Set(days.slice(-WEEK_DAYS));
  const inMonth = new Set(days);
  const own = rows.filter((r) => inMonth.has(r.day));

  const names = [...new Set([...ALWAYS_KEYS, ...own.map((r) => r.key).toSorted()])];
  return {
    keys: names.map((key) => {
      const keyRows = own.filter((r) => r.key === key);
      const callers = [...Map.groupBy(keyRows, (r) => `${r.caller}\u0000${r.model}`).values()]
        .map((group) => ({
          caller: group[0]!.caller,
          model: group[0]!.model,
          modelName: modelName(group[0]!.model),
          last7d: sum(group.filter((r) => inWeek.has(r.day))),
          last30d: sum(group),
        }))
        .toSorted(
          (a, b) =>
            (b.last30d.costUsd ?? -1) - (a.last30d.costUsd ?? -1) ||
            a.caller.localeCompare(b.caller) ||
            a.model.localeCompare(b.model),
        );
      const byDay = Map.groupBy(keyRows, (r) => r.day);
      return {
        key,
        last7d: sum(keyRows.filter((r) => inWeek.has(r.day))),
        last30d: sum(keyRows),
        callers,
        daily: days.map((day) => {
          const { costUsd, partial } = sum(byDay.get(day) ?? []);
          return { day, costUsd, partial };
        }),
      };
    }),
  };
}

function sum(rows: readonly ApiSpendRow[]): Spend {
  const known = rows.filter((r) => r.costUsd !== null);
  const total = known.reduce((s, r) => s + r.costUsd!, 0);
  return {
    costUsd: rows.length > 0 && known.length === 0 ? null : total,
    calls: rows.reduce((s, r) => s + r.calls, 0),
    partial: known.length > 0 && known.length < rows.length,
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
