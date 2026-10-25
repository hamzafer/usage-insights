import type { ApiSpend, ApiSpendSum } from "./types";

/**
 * The Overview's "Claude API" section: API Spend per Key and Caller as display strings. Pure,
 * tested with `bun test`. Money follows the Report's line: `$0.04`, `<$0.01` for a non-zero amount
 * under a cent, `?` for an unknown price (ADR 0004), `$0.04+?` when only part of a sum is priced (the Report's notation).
 */
export interface ApiSpendRow {
  key: string;
  /** No calls in the last 30 days: the row shows "no calls" instead of numbers. */
  noCalls: boolean;
  last7d: string;
  last30d: string;
  /** Calls in the last 30 days. */
  calls: string;
  callers: { label: string; model: string; last7d: string; last30d: string; calls: string }[];
}

export function money({ costUsd, partial }: ApiSpendSum): string {
  if (costUsd === null) return "?";
  const plus = partial ? "+?" : "";
  if (costUsd > 0 && costUsd < 0.005) return `<$0.01${plus}`;
  return `$${costUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${plus}`;
}

export function apiSpendRows(spend: ApiSpend): ApiSpendRow[] {
  return spend.keys.map((k) => ({
    key: k.key,
    noCalls: k.last30d.calls === 0,
    last7d: money(k.last7d),
    last30d: money(k.last30d),
    calls: String(k.last30d.calls),
    callers: k.callers.map((c) => ({
      label: c.caller.charAt(0).toUpperCase() + c.caller.slice(1),
      model: c.modelName,
      last7d: money(c.last7d),
      last30d: money(c.last30d),
      calls: String(c.last30d.calls),
    })),
  }));
}
