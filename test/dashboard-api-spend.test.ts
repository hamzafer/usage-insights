import { describe, expect, test } from "bun:test";
import { apiSpendFrom, buildApiSpend } from "../src/dashboard/api-spend.ts";
import type { ApiSpendRow } from "../src/store.ts";

// Synthetic values only. NOW is 2026-10-25 (local day in UTC).
const NOW = "2026-10-25T12:00:00.000Z";

function row(day: string, over: Partial<ApiSpendRow> = {}): ApiSpendRow {
  return { day, key: "personal", caller: "bouncer", model: "claude-haiku-4-5", calls: 2, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, costUsd: 0.01, ...over };
}

describe("buildApiSpend", () => {
  test("lists personal and work without rows, with zero days", () => {
    const { keys } = buildApiSpend([], NOW, "UTC");
    expect(keys.map((k) => k.key)).toEqual(["personal", "work"]);
    expect(keys[0]!.last7d).toEqual({ costUsd: 0, calls: 0, partial: false });
    expect(keys[0]!.callers).toEqual([]);
    expect(keys[0]!.daily).toHaveLength(30);
    expect(keys[0]!.daily[0]).toEqual({ day: "2026-09-26", costUsd: 0, partial: false });
    expect(keys[0]!.daily[29]!.day).toBe("2026-10-25");
  });

  test("adds other Keys with rows after the two fixed ones, sorted", () => {
    const { keys } = buildApiSpend([row("2026-10-25", { key: "env" }), row("2026-10-25", { key: "alpha" })], NOW, "UTC");
    expect(keys.map((k) => k.key)).toEqual(["personal", "work", "alpha", "env"]);
  });

  test("sums 7 and 30 days per Key and per Caller and model", () => {
    const rows = [
      row("2026-10-25", { costUsd: 0.03, calls: 3 }),
      row("2026-10-19", { costUsd: 0.01, calls: 1 }), // 7th day back: inside the week
      row("2026-10-18", { costUsd: 0.02, calls: 2 }), // outside the week, inside 30 days
      row("2026-10-25", { caller: "suggestions", model: "claude-opus-4-5", costUsd: 0.5, calls: 1 }),
      row("2026-09-25", { costUsd: 9, calls: 9 }), // 31 days back: out
      row("2026-10-25", { key: "work", costUsd: 1, calls: 1 }),
    ];
    const personal = buildApiSpend(rows, NOW, "UTC").keys[0]!;
    expect(personal.last7d.calls).toBe(5);
    expect(personal.last7d.costUsd).toBeCloseTo(0.54);
    expect(personal.last30d.calls).toBe(7);
    expect(personal.last30d.costUsd).toBeCloseTo(0.56);
    expect(personal.callers.map((c) => `${c.caller}/${c.model}`)).toEqual(["suggestions/claude-opus-4-5", "bouncer/claude-haiku-4-5"]);
    expect(personal.callers.map((c) => c.modelName)).toEqual(["Opus 4.5", "Haiku 4.5"]);
    expect(personal.callers[1]!.last7d.costUsd).toBeCloseTo(0.04);
    expect(personal.callers[1]!.last30d.costUsd).toBeCloseTo(0.06);
    expect(personal.daily.at(-1)!.costUsd).toBeCloseTo(0.53);
    expect(personal.daily.find((d) => d.day === "2026-10-20")!.costUsd).toBe(0);
  });

  test("an unknown price is null when all rows are unknown, partial when only some are", () => {
    const rows = [
      row("2026-10-25", { costUsd: null, model: "claude-mystery" }),
      row("2026-10-24", { costUsd: null, model: "claude-mystery" }),
      row("2026-10-24", { costUsd: 0.04 }),
    ];
    const personal = buildApiSpend(rows, NOW, "UTC").keys[0]!;
    expect(personal.last7d).toEqual({ costUsd: 0.04, calls: 6, partial: true });
    const mystery = personal.callers.find((c) => c.model === "claude-mystery")!;
    expect(mystery.last7d).toEqual({ costUsd: null, calls: 4, partial: false });
    expect(personal.callers.at(-1)!.model).toBe("claude-mystery");
    expect(personal.daily.at(-1)).toEqual({ day: "2026-10-25", costUsd: null, partial: false });
    expect(personal.daily.at(-2)).toEqual({ day: "2026-10-24", costUsd: 0.04, partial: true });
  });

  test("today follows the time zone", () => {
    const late = "2026-10-25T23:30:00.000Z"; // already the 26th in Oslo
    expect(buildApiSpend([], late, "Europe/Oslo").keys[0]!.daily.at(-1)!.day).toBe("2026-10-26");
    expect(buildApiSpend([], late, "UTC").keys[0]!.daily.at(-1)!.day).toBe("2026-10-25");
  });

  test("apiSpendFrom is at or before the oldest day used", () => {
    expect(apiSpendFrom(NOW, "UTC") <= "2026-09-26").toBe(true);
  });
});
