import { describe, expect, test } from "bun:test";
import { buildLastWeek } from "../src/dashboard/last-week.ts";
import { buildReport } from "../src/report/build.ts";
import { input, NOW } from "./report-fixtures.ts";

// The Overview's "Last week" line reuses the Report's week numbers (synthetic Report fixtures).
describe("buildLastWeek", () => {
  const week = buildLastWeek(buildReport(input));

  test("covers the Report's week, ending now", () => {
    expect(week.to).toBe(NOW);
    expect(week.from).toBe("2026-10-05T09:00:00.000Z");
  });

  test("final Waste of the Cycles that reset, with the average of the weeks before", () => {
    expect(week.cycles).toEqual([
      { provider: "codex", label: "Weekly", resets: 1, basis: "measured", waste: 0.2, previous: 0.4 },
    ]);
  });

  test("Limit Hits with the weekly average before and the Blocked Time", () => {
    expect(week.limitHits).toEqual({ count: 1, previousAvg: 0, blockedMs: 2 * 3_600_000 });
  });

  test("Overage spent per unit", () => {
    expect(week.overage).toEqual([{ unit: "$", spent: 15 }]);
  });

  test("a Cycle that reset without a measurable Waste is listed with null Waste", () => {
    const report = buildReport({
      ...input,
      readings: input.readings.map((r) => (r.provider === "codex" ? { ...r, limit: 0 } : r)),
    });
    expect(buildLastWeek(report).cycles).toContainEqual({
      provider: "codex",
      label: "Weekly",
      resets: 1,
      basis: null,
      waste: null,
      previous: null,
    });
  });
});
