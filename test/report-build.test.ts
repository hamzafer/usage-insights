import { describe, expect, test } from "bun:test";
import { buildReport } from "../src/report/build.ts";
import { input } from "./report-fixtures.ts";

const H = 3_600_000;
const report = buildReport(input);

describe("buildReport: the 7 days before now", () => {
  test("covers the week before now", () => {
    expect(report.from).toBe("2026-10-05T09:00:00.000Z");
    expect(report.to).toBe("2026-10-12T09:00:00.000Z");
  });

  test("final Waste for every Cycle that reset in the week, and only those", () => {
    expect(report.cycleWaste.map((c) => [c.provider, c.label, c.resetAt, c.waste?.share, c.waste?.lowConfidence])).toEqual([
      ["codex", "Weekly", "2026-10-08T09:00:00.000Z", expect.closeTo(0.2, 6), false],
    ]);
  });

  test("Pace for every running Cycle", () => {
    expect(report.pace.map((p) => [p.provider, p.label, p.expectedWaste])).toEqual([
      // Anchored at the previous Cycle's Reset (10-08 09:00, usage 0): 40% in 75h, 93h left → 89.6% used.
      ["codex", "Weekly", expect.closeTo(0.104, 6)],
    ]);
  });

  test("Limit Hits in the week with their Blocked Time", () => {
    expect(report.limitHits.map((h) => [h.provider, h.label, h.hitAt, h.endedBy, h.blockedInWeekMs])).toEqual([
      ["claude", "Session", "2026-10-10T10:00:00.000Z", "reset", 2 * H],
    ]);
  });

  test("Overage spent in the week, in its own unit", () => {
    expect(report.overage).toEqual([{ provider: "claude-work", label: "Extra usage spent", unit: "$", spent: 15 }]);
  });

  test("top Projects and models of the week across Providers", () => {
    expect(report.top.total).toBe(1_000_000);
    expect(report.top.byProject.map((s) => [s.name, s.share])).toEqual([
      ["alpha", 0.72],
      ["beta", 0.2],
      ["(other)", 0.08],
    ]);
    expect(report.top.byModel.map((s) => s.name)).toEqual(["claude-sonnet", "claude-opus", "gpt-5-codex"]);
  });

  test("trend vs the previous 4 weeks, counting only weeks that have data", () => {
    expect(report.trend.waste).toEqual([
      { provider: "codex", label: "Weekly", basis: "measured", thisWeek: 0.2, previous: 0.4, previousCycles: 2 },
    ]);
    // Readings start 09-20, so three earlier weeks have data; none had a Limit Hit.
    expect(report.trend.limitHits).toEqual({ thisWeek: 1, previousAvg: 0, previousWeeks: 3 });
    expect(report.trend.blockedMs).toEqual({ thisWeek: 2 * H, previousAvg: 0, previousWeeks: 3 });
    expect(report.trend.tokens.thisWeek).toBe(1_000_000);
    expect(report.trend.tokens.previousWeeks).toBe(3);
    expect(report.trend.tokens.previousAvg).toBeCloseTo(400_000 / 3, 6);
  });

  test("time without readings is reported as unknown, never as zero use", () => {
    expect(report.coverage.recorderGaps).toBe(1);
    const claude = report.coverage.providers.find((p) => p.provider === "claude")!;
    expect(claude.unknownMs).toBe(7 * 24 * H - 5 * 60_000);
    const codex = report.coverage.providers.find((p) => p.provider === "codex")!;
    expect(codex.unknownMs).toBe(7 * 24 * H);
  });
});

test("a Claude Cycle without a Measured Waste gets its Estimated Waste once calibrated, never mixed with Measured", () => {
  // Calibration from the running Cycle: 10 hourly intervals of +2% with 10k tokens each, so 5k tokens per 1%.
  const live = Array.from({ length: 11 }, (_, i) => ({
    provider: "claude-work",
    label: "Weekly",
    role: "cycle" as const,
    used: 10 + 2 * i,
    limit: 100,
    resetsAt: "2026-10-15T09:00:00.000Z",
    fetchedAt: new Date(Date.parse("2026-10-11T00:00:00.000Z") + i * H).toISOString(),
    source: "openusage",
  }));
  const event = (at: string, total: number) => ({
    provider: "claude-work",
    at,
    project: "/repos/alpha",
    model: "claude-opus",
    input: total,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
  });
  const calibrating = live.slice(1).map((r) => event(new Date(Date.parse(r.fetchedAt) - 30 * 60_000).toISOString(), 10_000));
  // The Cycle before (10-01 09:00 to 10-08 09:00, stepped back from the recorded Reset): 300k tokens, 60% used.
  const past = [event("2026-10-03T10:00:00.000Z", 300_000)];

  const r = buildReport({ ...input, readings: [...input.readings, ...live], tokens: [...input.tokens, ...past, ...calibrating] });
  const estimated = r.cycleWaste.find((c) => c.provider === "claude-work")!;
  expect([estimated.resetAt, estimated.waste?.share, estimated.waste?.basis, estimated.inferred]).toEqual([
    "2026-10-08T09:00:00.000Z",
    0.4,
    "estimated",
    true,
  ]);
  expect(r.trend.waste.find((w) => w.provider === "claude-work")).toMatchObject({ basis: "estimated", thisWeek: 0.4 });
});

test("an empty store builds a Report that says there is no data", () => {
  const empty = buildReport({ readings: [], gaps: [], tokens: [], now: "2026-10-12T09:00:00.000Z" });
  expect(empty.cycleWaste).toEqual([]);
  expect(empty.pace).toEqual([]);
  expect(empty.trend.limitHits.previousWeeks).toBe(0);
  expect(empty.top.total).toBe(0);
});
