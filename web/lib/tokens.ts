import { dateParts } from "./dates";
import type { TokensDaily } from "./types";

/**
 * Tokens by model over time (#19): pure logic, tested with `bun test` (tokens.test.ts).
 *
 * Model colors are a categorical set of their own (not the Provider colors): the dataviz reference
 * order blue, orange, aqua, yellow, magenta, green, violet, red, validated with its validator for
 * the light card (#ffffff) and the dark card (~#0f0f11). Every adjacent pair clears the CVD target
 * (ΔE ≥ 8: worst 9.1 light, 8.4 dark) and the normal-vision floor (ΔE ≥ 15: worst 19.6 / 19.3). On
 * light, aqua, yellow and magenta sit below 3:1, so the chart always has a legend and a table view.
 * Slots go by the model's 30-day rank, so a model keeps its color across ranges and filters.
 */

/** Light and dark hex per slot, in fixed order; never cycled. */
export const MODEL_SLOTS = [
  { light: "#2a78d6", dark: "#3987e5" },
  { light: "#eb6834", dark: "#d95926" },
  { light: "#1baf7a", dark: "#199e70" },
  { light: "#eda100", dark: "#c98500" },
  { light: "#e87ba4", dark: "#d55181" },
  { light: "#008300", dark: "#008300" },
  { light: "#4a3aa7", dark: "#9085e9" },
  { light: "#e34948", dark: "#e66767" },
] as const;

/** The neutral gray of "Other" (both themes). */
export const OTHER_COLOR = "#898781";

export const OTHER_KEY = "other";

export interface ModelSeries {
  /** Recharts data key: `m0`…`m7`, or `other` (model ids hold dots, which data keys read as paths). */
  key: string;
  name: string;
  /** Slot index into MODEL_SLOTS; null for Other. */
  slot: number | null;
  /** Model ids drawn by this series (one, or every folded one for Other). */
  ids: string[];
}

/**
 * Up to 8 models get a line each; 9 or more keep the top 7 and fold the rest into "Other", so a 9th
 * hue is never generated. `models` come ranked (largest first), as the API sends them.
 */
export function foldModels(models: readonly { id: string; name: string }[], slots: number = MODEL_SLOTS.length): ModelSeries[] {
  const own = models.length <= slots ? models : models.slice(0, slots - 1);
  const series: ModelSeries[] = own.map((m, i) => ({ key: `m${i}`, name: m.name, slot: i, ids: [m.id] }));
  const rest = models.slice(own.length);
  if (rest.length > 0) series.push({ key: OTHER_KEY, name: "Other", slot: null, ids: rest.map((m) => m.id) });
  return series;
}

/** "all" or a Provider id. */
export type ProviderFilter = string;

export interface TokensRow {
  date: string;
  total: number;
  [seriesKey: string]: number | string;
}

/** One row per day: tokens per series and the day's total, for one Provider or all of them. */
export function tokenRows(data: TokensDaily, series: readonly ModelSeries[], filter: ProviderFilter): TokensRow[] {
  const seriesOf = new Map(series.flatMap((s) => s.ids.map((id) => [id, s.key] as const)));
  return data.days.map((day) => {
    const row: TokensRow = { date: day.date, total: 0 };
    for (const s of series) row[s.key] = 0;
    for (const [provider, models] of Object.entries(day.byProvider)) {
      if (filter !== "all" && provider !== filter) continue;
      for (const [model, tokens] of Object.entries(models)) {
        const key = seriesOf.get(model) ?? OTHER_KEY;
        row[key] = ((row[key] as number | undefined) ?? 0) + tokens;
        row.total += tokens;
      }
    }
    return row;
  });
}

/** Series with any tokens in `rows` (others are left off the chart and legend, keeping their colors). */
export function visibleSeries(series: readonly ModelSeries[], rows: readonly TokensRow[]): ModelSeries[] {
  return series.filter((s) => rows.some((r) => ((r[s.key] as number | undefined) ?? 0) > 0));
}

/** 122771287 → "122,771,287". */
export function fullTokens(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** "2026-10-05" → "5 Oct" (a calendar day, so no time zone shift). */
export function dayLabel(date: string): string {
  const p = dateParts(`${date}T00:00:00Z`, "UTC");
  return `${p.day} ${p.monthName}`;
}

/** "2026-10-05" → "Mon 5 Oct". */
export function longDayLabel(date: string): string {
  return `${dateParts(`${date}T00:00:00Z`, "UTC").weekday} ${dayLabel(date)}`;
}
