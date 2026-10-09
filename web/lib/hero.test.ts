import { describe, expect, test } from "bun:test";
import { duration, heroDomain, heroRows, heroTable, timeTicks } from "./hero";
import type { HeroCycle } from "./types";

// Hero chart data logic, run by the root `bun test`. Synthetic values only.
const NOW = "2026-10-05T12:00:00.000Z";

function hero(over: Partial<HeroCycle> = {}): HeroCycle {
  return {
    provider: "codex",
    label: "Weekly",
    labels: ["Weekly"],
    running: true,
    start: "2026-10-01T00:00:00.000Z",
    resetsAt: "2026-10-08T00:00:00.000Z",
    endedAt: null,
    limitShare: 1,
    readings: [
      { at: "2026-10-01T01:00:00.000Z", usedShare: 0.1, basis: "measured" },
      { at: "2026-10-01T01:05:00.000Z", usedShare: 0.1, basis: "measured" },
      { at: "2026-10-05T11:55:00.000Z", usedShare: 0.4, basis: "measured" },
    ],
    pace: {
      points: [
        { at: "2026-10-05T11:55:00.000Z", usedShare: 0.4 },
        { at: "2026-10-08T00:00:00.000Z", usedShare: 0.62 },
      ],
      projectedShare: 0.62,
      expectedWaste: 0.38,
      projectedLimitHitAt: null,
      basis: "measured",
    },
    gaps: [
      { from: "2026-10-01T00:00:00.000Z", to: "2026-10-01T01:00:00.000Z" },
      { from: "2026-10-01T01:05:00.000Z", to: "2026-10-05T11:55:00.000Z" },
    ],
    ...over,
  };
}

describe("hero chart", () => {
  test("a gap between readings breaks the area with a null, never a zero", () => {
    const rows = heroRows(hero());
    const gap = rows.filter((r) => r.used === null && r.pace === undefined);
    expect(gap).toHaveLength(1); // the gap before the first reading needs no break
    expect(rows.some((r) => r.used === 0)).toBe(false);
    expect(rows.map((r) => r.t)).toEqual(rows.map((r) => r.t).toSorted((a, b) => a - b));
  });

  test("a reading with gaps on both sides is marked alone (drawn as a dot)", () => {
    const h = hero({
      readings: [
        { at: "2026-10-01T01:00:00.000Z", usedShare: 0.1, basis: "measured" },
        { at: "2026-10-02T01:00:00.000Z", usedShare: 0.2, basis: "measured" },
        { at: "2026-10-05T11:50:00.000Z", usedShare: 0.4, basis: "measured" },
        { at: "2026-10-05T11:55:00.000Z", usedShare: 0.4, basis: "measured" },
      ],
      gaps: [
        { from: "2026-10-01T01:00:00.000Z", to: "2026-10-02T01:00:00.000Z" },
        { from: "2026-10-02T01:00:00.000Z", to: "2026-10-05T11:50:00.000Z" },
      ],
    });
    const alone = heroRows(h).filter((r) => r.alone).map((r) => r.used);
    expect(alone).toEqual([10, 20]);
  });

  test("Pace starts on the newest reading and ends at the Reset", () => {
    const rows = heroRows(hero());
    const newest = rows.find((r) => r.t === Date.parse("2026-10-05T11:55:00.000Z"))!;
    expect(newest.used).toBe(40);
    expect(newest.pace).toBe(40);
    expect(rows.at(-1)).toEqual({ t: Date.parse("2026-10-08T00:00:00.000Z"), used: null, pace: 62 });
  });

  test("the x-axis spans the Cycle's start to its Reset", () => {
    expect(heroDomain(hero(), NOW)).toEqual([Date.parse("2026-10-01T00:00:00.000Z"), Date.parse("2026-10-08T00:00:00.000Z")]);
    const unknownStart = heroDomain(hero({ start: null }), NOW);
    expect(unknownStart[0]).toBe(Date.parse("2026-10-01T01:00:00.000Z"));
  });

  test("ticks: one a day for a week, whole hours for a 5-hour Cycle, at most 8", () => {
    const week = timeTicks([Date.parse("2026-10-01T00:00:00.000Z"), Date.parse("2026-10-08T00:00:00.000Z")]);
    expect(week.length).toBeGreaterThanOrEqual(6);
    expect(week.length).toBeLessThanOrEqual(8);
    expect(week[1]! - week[0]!).toBeGreaterThanOrEqual(23 * 3_600_000); // a DST day can be 23h
    const five = timeTicks([Date.parse("2026-10-05T10:30:00.000Z"), Date.parse("2026-10-05T15:30:00.000Z")]);
    expect(five).toHaveLength(5);
    expect(five.every((t) => t % 60_000 === 0)).toBe(true);
  });

  test("table: changes only, gaps as unknown, Pace marked ~, newest first", () => {
    const rows = heroTable(hero());
    expect(rows.map((r) => r.kind)).toEqual([
      "Pace at the Reset",
      "Reading",
      "No readings for 4d 10h",
      "Reading", // 10% at 01:00; the unchanged 01:05 reading folds into it
      "No readings for 1h",
    ]);
    expect(rows[0]!.used).toBe("~62%");
    expect(rows.find((r) => r.kind.startsWith("No readings"))!.used).toBe("unknown");
  });

  test("duration", () => {
    expect(duration(30_000)).toBe("now");
    expect(duration(12 * 60_000)).toBe("12m");
    expect(duration(5 * 3_600_000 + 10 * 60_000)).toBe("5h 10m");
    expect(duration(2 * 86_400_000 + 4 * 3_600_000)).toBe("2d 4h");
  });
});
