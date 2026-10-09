import { describe, expect, test } from "bun:test";
import { averages, blockedText, cyclesForRange, rangeCaption } from "./history";
import type { HistoryCycle } from "./types";

// Pure logic of the Waste and Limit history section. Synthetic values only.
function cycle(over: Partial<HistoryCycle> = {}): HistoryCycle {
  return {
    label: "Weekly",
    from: null,
    resetAt: "2026-10-01T00:00:00.000Z",
    running: false,
    usedShare: 0.7,
    wasteShare: 0.3,
    basis: "measured",
    lowConfidence: false,
    inferred: false,
    limitHits: [],
    ...over,
  };
}

describe("history", () => {
  test("the range picks the newest 4 or 12 Cycles and says so", () => {
    const all = Array.from({ length: 15 }, (_, i) => cycle({ usedShare: i / 100 }));
    expect(cyclesForRange(all, "7d").map((c) => c.usedShare)).toEqual([0.11, 0.12, 0.13, 0.14]);
    expect(cyclesForRange(all, "30d")).toHaveLength(12);
    expect(rangeCaption("7d")).toBe("Last 4 Cycles");
    expect(rangeCaption("30d")).toBe("Last 12 Cycles");
  });

  test("averages keep Measured and Estimated apart and skip the running Cycle", () => {
    const result = averages([
      cycle({ usedShare: 0.6, wasteShare: 0.4 }),
      cycle({ usedShare: 0.8, wasteShare: 0.2 }),
      cycle({ basis: "estimated", usedShare: 0.5, wasteShare: 0.5 }),
      cycle({ running: true, usedShare: 0.1, wasteShare: null }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ basis: "measured", count: 2 });
    expect(result[0]!.used).toBeCloseTo(0.7);
    expect(result[0]!.wasted).toBeCloseTo(0.3);
    expect(result[1]).toEqual({ basis: "estimated", count: 1, used: 0.5, wasted: 0.5 });
    expect(averages([cycle({ running: true, wasteShare: null })])).toEqual([]);
  });

  test("Blocked Time reads as days and hours", () => {
    expect(blockedText((3 * 24 + 17) * 3_600_000 + 5 * 60_000)).toBe("3d 17h");
    expect(blockedText(2 * 24 * 3_600_000)).toBe("2d");
    expect(blockedText(3_600_000)).toBe("1h");
    expect(blockedText(80 * 60_000)).toBe("1h 20m");
    expect(blockedText(45 * 60_000)).toBe("45m");
  });
});
