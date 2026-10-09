import { describe, expect, test } from "bun:test";
import { dayLabel, foldModels, fullTokens, longDayLabel, tokenRows, visibleSeries } from "./tokens";
import type { TokensDaily } from "./types";

// Pure logic of the tokens-by-model chart, run by the root `bun test`. Synthetic values only.
const models = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `model-${i}`, name: `Model ${i}` }));

describe("foldModels", () => {
  test("8 models get a slot each, in rank order, no Other", () => {
    const series = foldModels(models(8));
    expect(series).toHaveLength(8);
    expect(series.map((s) => s.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(series.some((s) => s.key === "other")).toBe(false);
  });

  test("9 or more keep the top 7 and fold the rest into Other", () => {
    const series = foldModels(models(11));
    expect(series).toHaveLength(8);
    expect(series.slice(0, 7).map((s) => s.ids[0])).toEqual(models(7).map((m) => m.id));
    expect(series[7]).toEqual({ key: "other", name: "Other", slot: null, ids: ["model-7", "model-8", "model-9", "model-10"] });
  });

  test("no models, no series", () => {
    expect(foldModels([])).toEqual([]);
  });
});

const data: TokensDaily = {
  range: "7d",
  days: [
    { date: "2026-10-04", byProvider: {} },
    {
      date: "2026-10-05",
      byProvider: { claude: { "claude-opus-5-5": 600 }, codex: { "gpt-6-astra": 1_000, "gpt-5.5": 50 } },
    },
  ],
  models: [
    { id: "gpt-6-astra", name: "GPT-6 Astra" },
    { id: "claude-opus-5-5", name: "Opus 5.5" },
    { id: "gpt-5.5", name: "GPT-5.5" },
  ],
  providers: ["claude", "codex"],
};

describe("tokenRows", () => {
  const series = foldModels(data.models);

  test("all Providers: per series per day, zero days kept, with totals", () => {
    expect(tokenRows(data, series, "all")).toEqual([
      { date: "2026-10-04", total: 0, m0: 0, m1: 0, m2: 0 },
      { date: "2026-10-05", total: 1_650, m0: 1_000, m1: 600, m2: 50 },
    ]);
  });

  test("one Provider keeps only its tokens; colors (slots) do not move", () => {
    const rows = tokenRows(data, series, "claude");
    expect(rows[1]).toEqual({ date: "2026-10-05", total: 600, m0: 0, m1: 600, m2: 0 });
    expect(visibleSeries(series, rows)).toEqual([series[1]!]);
    expect(visibleSeries(series, rows)[0]!.slot).toBe(1);
  });

  test("folded models add up in Other", () => {
    const folded = foldModels(data.models, 2);
    expect(tokenRows(data, folded, "all")[1]).toEqual({ date: "2026-10-05", total: 1_650, m0: 1_000, other: 650 });
  });
});

describe("number and day formats", () => {
  test("full numbers with separators", () => {
    expect(fullTokens(122_771_287)).toBe("122,771,287");
  });

  test("calendar day labels", () => {
    expect(dayLabel("2026-10-05")).toBe("5 Oct");
    expect(longDayLabel("2026-10-05")).toBe("Mon 5 Oct");
  });
});
