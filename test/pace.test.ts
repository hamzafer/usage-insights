import { expect, test } from "bun:test";
import { paceOfRunningCycles } from "../src/pace.ts";
import { deriveWindows, type Reading } from "../src/window-model.ts";

function reading(at: string, used: number, over: Partial<Reading> = {}): Reading {
  return {
    provider: "claude",
    label: "Weekly",
    role: "cycle",
    used,
    limit: 100,
    resetsAt: "2026-10-15T00:00:00.000Z",
    fetchedAt: at,
    source: "openusage",
    ...over,
  };
}

const NOW = "2026-10-10T06:00:00.000Z";

test("Pace projects usage linearly to the Reset, giving the Waste the Cycle is heading for", () => {
  // 10% per day from Oct 8 to Oct 10; 5 days left at 30% → 80% used, 20% Waste.
  const windows = deriveWindows(
    [reading("2026-10-08T00:00:00.000Z", 10), reading("2026-10-09T00:00:00.000Z", 20), reading("2026-10-10T00:00:00.000Z", 30)],
    NOW,
  );

  expect(paceOfRunningCycles(windows)).toEqual([
    {
      provider: "claude",
      label: "Weekly",
      resetsAt: "2026-10-15T00:00:00.000Z",
      lastReadingAt: "2026-10-10T00:00:00.000Z",
      usedShare: 0.3,
      periodMs: null,
      projectedShare: 0.8,
      expectedWaste: 0.2,
      projectedLimitHitAt: null,
      basis: "measured",
    },
  ]);
});

test("a Cycle heading past its limit has no Waste and a projected Limit Hit", () => {
  const windows = deriveWindows([reading("2026-10-08T00:00:00.000Z", 20), reading("2026-10-10T00:00:00.000Z", 60)], NOW);

  expect(paceOfRunningCycles(windows)).toEqual([
    expect.objectContaining({ projectedShare: 1, expectedWaste: 0, projectedLimitHitAt: "2026-10-12T00:00:00.000Z" }),
  ]);
});

test("ended Cycles and Sessions get no Pace; a single reading gives no rate yet", () => {
  const windows = deriveWindows(
    [
      reading("2026-10-01T00:00:00.000Z", 10, { resetsAt: "2026-10-08T00:00:00.000Z" }),
      reading("2026-10-09T00:00:00.000Z", 5, { provider: "codex" }),
      reading("2026-10-09T00:00:00.000Z", 5, { provider: "codex", label: "Session", role: "session" }),
      reading("2026-10-09T01:00:00.000Z", 9, { provider: "codex", label: "Session", role: "session" }),
    ],
    NOW,
  );

  expect(paceOfRunningCycles(windows)).toEqual([
    expect.objectContaining({ provider: "codex", label: "Weekly", projectedShare: null, expectedWaste: null }),
  ]);
});

const WEEK = 7 * 24 * 3_600_000;

test("with a known Window length, Pace is anchored at the Cycle's start (usage 0), so one spike does not dominate", () => {
  // The Cycle resetting Oct 15 00:00 started Oct 8 00:00. From the last two readings alone
  // (10% → 30% in an hour) it would hit the limit within hours; from the anchor it is 30% in
  // 2 days, 15% a day: the limit is reached 70% / 15% = 4 2/3 days after Oct 10 00:00.
  const windows = deriveWindows(
    [reading("2026-10-09T23:00:00.000Z", 10, { periodMs: WEEK }), reading("2026-10-10T00:00:00.000Z", 30, { periodMs: WEEK })],
    NOW,
  );

  expect(paceOfRunningCycles(windows)).toEqual([
    expect.objectContaining({
      usedShare: 0.3,
      periodMs: WEEK,
      projectedShare: 1,
      expectedWaste: 0,
      projectedLimitHitAt: "2026-10-14T16:00:00.000Z",
    }),
  ]);
});

test("anchored at the Cycle's start, a single reading already gives a Pace", () => {
  // 20% in 2 days → 10% a day → 70% at the Reset, 30% Waste.
  const windows = deriveWindows([reading("2026-10-10T00:00:00.000Z", 20, { periodMs: WEEK })], NOW);

  expect(paceOfRunningCycles(windows)).toEqual([
    expect.objectContaining({ projectedShare: 0.7, expectedWaste: 0.3, projectedLimitHitAt: null }),
  ]);
});

test("an untouched Cycle with a known length heads for 100% Waste", () => {
  const month = 30 * 24 * 3_600_000;
  const windows = deriveWindows(
    [reading("2026-10-10T00:00:00.000Z", 0, { periodMs: month, resetsAt: "2026-11-01T00:00:00.000Z" })],
    NOW,
  );

  expect(paceOfRunningCycles(windows)).toEqual([expect.objectContaining({ usedShare: 0, expectedWaste: 1 })]);
});

test("without a Window length, Pace still uses the Cycle's own readings", () => {
  const windows = deriveWindows([reading("2026-10-09T23:00:00.000Z", 10), reading("2026-10-10T00:00:00.000Z", 30)], NOW);

  expect(paceOfRunningCycles(windows)).toEqual([
    expect.objectContaining({ periodMs: null, projectedLimitHitAt: "2026-10-10T03:30:00.000Z" }),
  ]);
});
