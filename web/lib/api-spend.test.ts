import { describe, expect, test } from "bun:test";
import { apiSpendRows, money } from "./api-spend";
import type { ApiSpend, ApiSpendSum } from "./types";

// Synthetic values only.
const sum = (costUsd: number | null, calls: number, partial = false): ApiSpendSum => ({ costUsd, calls, partial });

describe("money", () => {
  test("two decimals, a cent floor for non-zero amounts, ? for unknown", () => {
    expect(money(sum(0.04, 1))).toBe("$0.04");
    expect(money(sum(12.3, 1))).toBe("$12.30");
    expect(money(sum(1234.5, 1))).toBe("$1,234.50");
    expect(money(sum(0.004, 1))).toBe("<$0.01");
    expect(money(sum(0, 0))).toBe("$0.00");
    expect(money(sum(null, 3))).toBe("?");
  });

  test("a partial sum is a lower bound", () => {
    expect(money(sum(0.04, 3, true))).toBe("$0.04+?");
    expect(money(sum(0.002, 3, true))).toBe("<$0.01+?");
    expect(money(sum(0, 2, true))).toBe("?");
  });
});

describe("apiSpendRows", () => {
  const data: ApiSpend = {
    keys: [
      {
        key: "personal",
        last7d: sum(0.04, 12),
        last30d: sum(0.1, 40),
        callers: [
          { caller: "bouncer", model: "claude-haiku-4-5", modelName: "Haiku 4.5", last7d: sum(0.03, 10), last30d: sum(0.08, 30) },
          { caller: "suggestions", model: "claude-opus-4-5", modelName: "Opus 4.5", last7d: sum(0.01, 2), last30d: sum(0.02, 10) },
        ],
        daily: [],
      },
      { key: "work", last7d: sum(0, 0), last30d: sum(0, 0), callers: [], daily: [] },
    ],
  };

  test("a row per Key with its Callers, calls over 30 days", () => {
    const [personal] = apiSpendRows(data);
    expect(personal).toMatchObject({ key: "personal", noCalls: false, last7d: "$0.04", last30d: "$0.10", calls: "40" });
    expect(personal!.callers).toEqual([
      { label: "Bouncer", model: "Haiku 4.5", last7d: "$0.03", last30d: "$0.08", calls: "30" },
      { label: "Suggestions", model: "Opus 4.5", last7d: "$0.01", last30d: "$0.02", calls: "10" },
    ]);
  });

  test("a Key without calls in 30 days says so", () => {
    const work = apiSpendRows(data)[1]!;
    expect(work.noCalls).toBe(true);
    expect(work.callers).toEqual([]);
  });

  test("an unknown price shows as ? while its calls still count", () => {
    const unknown: ApiSpend = {
      keys: [{ ...data.keys[0]!, last7d: sum(null, 2), last30d: sum(null, 2), callers: [] }],
    };
    expect(apiSpendRows(unknown)[0]).toMatchObject({ noCalls: false, last7d: "?", last30d: "?", calls: "2" });
  });
});
