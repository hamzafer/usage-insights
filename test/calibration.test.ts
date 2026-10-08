import { describe, expect, test } from "bun:test";
import { type Calibration, calibrate, claudeCalibration, estimateCycleWaste, formatCalibration, MIN_CALIBRATION_MOVEMENT, MIN_CALIBRATION_SAMPLES } from "../src/calibration.ts";
import type { CycleTokens } from "../src/token-shares.ts";
import type { TokenEvent } from "../src/store.ts";
import { deriveWindows, type Reading } from "../src/window-model.ts";
import { reading, tokenEvent } from "./dashboard-fixtures.ts";

// Synthetic Snapshots and token events only (ADR 0002).

const NOW = "2026-10-20T12:00:00.000Z";
const WEEKLY_RESET = "2026-10-26T00:00:00.000Z";
const HOUR = 3_600_000;
const START = Date.parse("2026-10-19T00:00:00.000Z");

function at(hours: number): string {
  return new Date(START + hours * HOUR).toISOString();
}

/**
 * `steps` hourly live Snapshots of claude's Weekly Cycle rising `pointsPerStep` each, with
 * `tokensPerPoint` tokens logged inside every interval.
 */
function weeklyRun(steps: number, pointsPerStep: number, tokensPerPoint: number, provider = "claude") {
  const readings: Reading[] = [];
  const events: TokenEvent[] = [];
  for (let i = 0; i <= steps; i++) {
    readings.push(reading(provider, "Weekly", "cycle", 10 + i * pointsPerStep, WEEKLY_RESET, at(i)));
    if (i < steps) events.push(tokenEvent(provider, at(i + 0.5), "/x/alpha", "claude-opus-5", pointsPerStep * tokensPerPoint));
  }
  return { readings, events };
}

describe("calibration", () => {
  test("with too few Snapshot intervals it is calibrating and gives no tokens per 1%", () => {
    const { readings, events } = weeklyRun(3, 2, 1000);
    const weekly = calibrate(readings, events, NOW).find((c) => c.role === "cycle");
    expect(weekly).toMatchObject({
      provider: "claude",
      label: "Weekly",
      role: "cycle",
      samples: 3,
      movement: 6,
      ready: false,
      tokensPerPercent: null,
    });
  });

  test(`ready after ${MIN_CALIBRATION_SAMPLES} intervals and ${MIN_CALIBRATION_MOVEMENT} points of movement: tokens per 1%`, () => {
    const { readings, events } = weeklyRun(12, 2, 50_000);
    const weekly = calibrate(readings, events, NOW).find((c) => c.role === "cycle");
    expect(weekly).toMatchObject({ samples: 12, movement: 24, tokens: 1_200_000, ready: true, tokensPerPercent: 50_000 });
  });

  test("enough samples but too little movement stays calibrating", () => {
    const { readings, events } = weeklyRun(15, 1, 50_000);
    const weekly = calibrate(readings, events, NOW).find((c) => c.role === "cycle");
    expect(weekly).toMatchObject({ samples: 15, movement: 15, ready: false, tokensPerPercent: null });
  });

  test("tokens of intervals where rounded used% did not move still count, so rounding evens out", () => {
    // 1 point every second hour, 30k tokens every hour: 60k tokens per point.
    const readings: Reading[] = [];
    const events: TokenEvent[] = [];
    for (let i = 0; i <= 40; i++) {
      readings.push(reading("claude", "Weekly", "cycle", 10 + Math.floor(i / 2), WEEKLY_RESET, at(i)));
      if (i < 40) events.push(tokenEvent("claude", at(i + 0.5), null, "claude-opus-5", 30_000));
    }
    const weekly = calibrate(readings, events, NOW).find((c) => c.role === "cycle");
    expect(weekly).toMatchObject({ samples: 20, movement: 20, ready: true, tokensPerPercent: 60_000 });
  });

  test("learns from live Snapshots only, per Claude account; Codex is Measured and not calibrated", () => {
    const personal = weeklyRun(12, 2, 50_000);
    const work = weeklyRun(12, 2, 20_000, "claude-work");
    const backfill = Array.from({ length: 12 }, (_, i) =>
      reading("claude", "Weekly", "cycle", 50 + i, WEEKLY_RESET, at(i + 0.25), "backfill:claude"),
    );
    const codex = weeklyRun(12, 2, 1_000, "codex");
    const all = calibrate(
      [...personal.readings, ...work.readings, ...backfill, ...codex.readings],
      [...personal.events, ...work.events, ...codex.events],
      NOW,
    );
    expect(all.map((c) => [c.provider, c.role, c.tokensPerPercent])).toEqual([
      ["claude", "session", null],
      ["claude", "cycle", 50_000],
      ["claude-work", "session", null],
      ["claude-work", "cycle", 20_000],
    ]);
  });

  test("a Reset between Snapshots is not an interval", () => {
    const readings = [
      reading("claude", "Session", "session", 80, "2026-10-19T05:00:00.000Z", at(4)),
      reading("claude", "Session", "session", 5, "2026-10-19T11:00:00.000Z", at(6)),
    ];
    const events = [tokenEvent("claude", at(5), null, "claude-opus-5", 1_000)];
    const session = calibrate(readings, events, NOW).find((c) => c.role === "session");
    expect(session).toMatchObject({ label: "Session", samples: 0, movement: 0, tokens: 0 });
  });

  test("intervals after the newest token event are skipped until the token Backfill reads them in", () => {
    const { readings, events } = weeklyRun(12, 2, 50_000);
    const weekly = calibrate(readings, events.slice(0, 6), NOW).find((c) => c.role === "cycle");
    expect(weekly).toMatchObject({ samples: 6, movement: 12 });
  });
});

function cycleTokens(provider: string, from: string, to: string, total: number, over: Partial<CycleTokens> = {}): CycleTokens {
  return { provider, label: "Weekly", from, to, running: false, inferred: true, total, byProject: [], byModel: [], ...over };
}

function weeklyCalibration(provider: string, tokensPerPercent: number | null): Calibration {
  return {
    provider,
    label: "Weekly",
    role: "cycle",
    samples: tokensPerPercent ? 12 : 2,
    movement: tokensPerPercent ? 24 : 4,
    tokens: 0,
    ready: tokensPerPercent !== null,
    tokensPerPercent,
  };
}

describe("Estimated Waste", () => {
  const past = cycleTokens("claude", "2026-10-05T00:00:00.000Z", "2026-10-12T00:00:00.000Z", 3_000_000);

  test("converts an ended Cycle's tokens with the account's tokens per 1%, marked estimated", () => {
    const [estimate] = estimateCycleWaste([past], [weeklyCalibration("claude", 50_000)], []);
    // 3M tokens / 50k per 1% = 60% used, so 40% Waste.
    expect(estimate).toEqual({
      provider: "claude",
      label: "Weekly",
      from: "2026-10-05T00:00:00.000Z",
      to: "2026-10-12T00:00:00.000Z",
      inferred: true,
      tokens: 3_000_000,
      usedShare: 0.6,
      share: 0.4,
      basis: "estimated",
    });
  });

  test("nothing while calibrating, and nothing for running Cycles or other accounts", () => {
    const running = cycleTokens("claude", "2026-10-12T00:00:00.000Z", "2026-10-19T00:00:00.000Z", 10, { running: true });
    const work = cycleTokens("claude-work", past.from, past.to, 10);
    expect(estimateCycleWaste([past, work], [weeklyCalibration("claude", null)], [])).toEqual([]);
    expect(estimateCycleWaste([running, work], [weeklyCalibration("claude", 50_000)], [])).toEqual([]);
  });

  test("more tokens than the allowance is 0% Waste, never negative", () => {
    const [estimate] = estimateCycleWaste([{ ...past, total: 6_000_000 }], [weeklyCalibration("claude", 50_000)], []);
    expect(estimate).toMatchObject({ usedShare: 1.2, share: 0 });
  });

  test("a Cycle with Measured Waste from live Snapshots gets no estimate (never mixed)", () => {
    const measured = deriveWindows(
      [
        reading("claude", "Weekly", "cycle", 30, past.to, "2026-10-06T00:00:00.000Z"),
        reading("claude", "Weekly", "cycle", 70, past.to, "2026-10-11T23:55:00.000Z"),
      ],
      NOW,
    );
    expect(estimateCycleWaste([past], [weeklyCalibration("claude", 50_000)], measured)).toEqual([]);
  });
});

describe("from stored data", () => {
  test("a ready calibration turns earlier Claude Cycles' tokens into Estimated Waste; the running one stays tokens only", () => {
    const { readings, events } = weeklyRun(12, 2, 50_000);
    // An earlier Cycle (before live recording) with 2M tokens: 40% used, 60% Waste.
    const earlier = [tokenEvent("claude", "2026-10-14T10:00:00.000Z", "/x/alpha", "claude-opus-5", 2_000_000)];
    const result = claudeCalibration(readings, [...earlier, ...events], NOW);
    expect(result.calibrations.find((c) => c.role === "cycle")?.ready).toBe(true);
    expect(result.estimates).toEqual([
      expect.objectContaining({ provider: "claude", from: "2026-10-12T00:00:00.000Z", to: "2026-10-19T00:00:00.000Z", share: 0.6, basis: "estimated" }),
    ]);
    expect(result.cycles.map((c) => c.running)).toEqual([false, true]);
  });

  test("on today's kind of data (a few live Snapshots) every account is calibrating", () => {
    const { readings, events } = weeklyRun(2, 1, 10_000);
    const result = claudeCalibration(readings, events, NOW);
    expect(result.calibrations.every((c) => !c.ready)).toBe(true);
    expect(result.estimates).toEqual([]);
  });
});

describe("summary section", () => {
  test("shows calibrating with tokens only, and ready with tokens per 1% and ~ Estimated Waste", () => {
    const calibrating: Calibration = { ...weeklyCalibration("claude-work", null), tokens: 90_000 };
    const ready: Calibration = { ...weeklyCalibration("claude", 50_000), tokens: 1_200_000 };
    const estimate = estimateCycleWaste(
      [cycleTokens("claude", "2026-10-05T00:00:00.000Z", "2026-10-12T00:00:00.000Z", 3_000_000)],
      [ready],
      [],
    );
    const tokensOnly = [cycleTokens("claude-work", "2026-10-05T00:00:00.000Z", "2026-10-12T00:00:00.000Z", 700_000)];

    const out = formatCalibration([ready, calibrating], estimate, tokensOnly, { timeZone: "UTC" });

    expect(out).toBe(
      [
        "Claude calibration (tokens per 1%, from live Snapshots)",
        "claude",
        "  Weekly  ready        50k tokens per 1%  12 samples, 24 points",
        "    Estimated Waste  2026-10-05 00:00 to 2026-10-12 00:00  3M tokens  Waste ~40%  (Cycle inferred)",
        "claude-work",
        `  Weekly  calibrating  2 samples, 4 points (needs ${MIN_CALIBRATION_SAMPLES} samples, ${MIN_CALIBRATION_MOVEMENT} points)`,
        "    tokens only  2026-10-05 00:00 to 2026-10-12 00:00  700k tokens",
      ].join("\n"),
    );
  });

  test("empty without Claude data", () => {
    expect(formatCalibration([], [], [], {})).toBe("");
  });
});
