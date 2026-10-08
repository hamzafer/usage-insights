import { describe, expect, test } from "bun:test";
import { buildHealth, buildHistory, buildOverview } from "../src/dashboard/view-model.ts";
import { NOW, reading, syntheticData } from "./dashboard-fixtures.ts";

describe("overview", () => {
  test("lists every Provider with Cycles, sorted by name", () => {
    expect(buildOverview(syntheticData(), NOW).map((p) => p.provider)).toEqual(["claude", "codex"]);
  });

  test("shows the last ended Cycle's Waste per Cycle line, keeping basis and confidence", () => {
    const [claude, codex] = buildOverview(syntheticData(), NOW);
    expect(codex!.lastCycles).toEqual([
      {
        label: "Weekly",
        endedAt: "2026-10-01T00:00:00.000Z",
        waste: { share: 0.3, lastReadingAt: "2026-09-30T23:50:00.000Z", lowConfidence: false, basis: "measured" },
      },
    ]);
    expect(claude!.lastCycles[0]!.waste).toMatchObject({ share: 0.45, basis: "estimated", lowConfidence: true });
  });

  test("shows the running Cycle's current usage and Pace", () => {
    const codex = buildOverview(syntheticData(), NOW)[1]!;
    expect(codex.running).toHaveLength(1);
    const running = codex.running[0]!;
    expect(running.label).toBe("Weekly");
    expect(running.usedShare).toBeCloseTo(0.4);
    expect(running.resetsAt).toBe("2026-10-08T00:00:00.000Z");
    expect(running.pace.expectedWaste).not.toBeNull();
    expect(running.pace.expectedWaste!).toBeLessThan(0.6);
    // From the previous Reset (10-01 00:00) to now is 4.5 of 7 days.
    expect(running.elapsedShare).toBeCloseTo(4.5 / 7);
  });

  test("counts Limit Hits of the last 28 days with their Blocked Time", () => {
    const codex = buildOverview(syntheticData(), NOW)[1]!;
    expect(codex.limitHits).toEqual({ count: 1, blockedMs: 3_600_000, stillBlocked: false });
  });

  test("shows Overage of the running and last ended Cycle in its own unit", () => {
    const codex = buildOverview(syntheticData(), NOW)[1]!;
    expect(codex.overage).toEqual([
      { cycleLabel: "Weekly", cycleEndedAt: null, overageLabel: "Workspace Credits", unit: "credits", spent: 15 },
    ]);
  });

  test("a Provider with only a running Cycle has no last Waste yet", () => {
    const data = {
      readings: [reading("cursor", "Total usage", "cycle", 5, "2026-11-01T00:00:00.000Z", "2026-10-05T10:00:00.000Z")],
      latest: [],
      gaps: [],
    };
    const [cursor] = buildOverview(data, NOW);
    expect(cursor!.lastCycles).toEqual([]);
    expect(cursor!.running[0]!.pace.expectedWaste).toBeNull();
    // Its start is unknown without a previous Reset.
    expect(cursor!.running[0]!.elapsedShare).toBeNull();
  });
});

describe("history", () => {
  test("is null for an unknown Provider", () => {
    expect(buildHistory(syntheticData(), "nobody", NOW)).toBeNull();
  });

  test("lists ended Cycles and ended started Sessions with their Waste, oldest first", () => {
    const codex = buildHistory(syntheticData(), "codex", NOW)!;
    expect(codex.cycles.map((c) => [c.label, c.endedAt, c.waste?.share])).toEqual([
      ["Weekly", "2026-10-01T00:00:00.000Z", 0.3],
    ]);
    expect(codex.sessions.map((s) => [s.endedAt, s.waste?.share])).toEqual([
      ["2026-10-02T05:00:00.000Z", 0.4],
      ["2026-10-03T10:00:00.000Z", 0],
    ]);
  });

  test("shows Idle Capacity per Cycle, the running one marked", () => {
    const codex = buildHistory(syntheticData(), "codex", NOW)!;
    expect(codex.idle.map((i) => [i.label, i.running])).toEqual([
      ["Weekly", false],
      ["Weekly", true],
    ]);
    // The running Cycle (from 10-01 00:00 to now) had two 5-hour Sessions open.
    const running = codex.idle[1]!;
    expect(running.idleMs).toBe((4.5 * 24 - 10) * 3_600_000);
  });

  test("marks stretches without recorded Snapshots as gaps, up to now", () => {
    const codex = buildHistory(syntheticData(), "codex", NOW)!;
    expect(codex.gaps[0]).toEqual({ from: "2026-09-25T00:00:00.000Z", to: "2026-09-30T23:50:00.000Z" });
    expect(codex.gaps.every((g) => Date.parse(g.to) - Date.parse(g.from) > 60 * 60_000)).toBe(true);
  });

  test("Backfill readings are not counted as recorder coverage or gaps", () => {
    const claude = buildHistory(syntheticData(), "claude", NOW)!;
    expect(claude.gaps).toEqual([]);
  });
});

describe("data health", () => {
  test("shows the last Snapshot per Provider (Backfill readings are not Snapshots) and whether it is stale", () => {
    const health = buildHealth(syntheticData(), NOW);
    expect(health.providers).toEqual([
      { provider: "claude", lastSnapshotAt: null, stale: true },
      { provider: "codex", lastSnapshotAt: "2026-10-05T11:55:00.000Z", stale: false },
      { provider: "cursor", lastSnapshotAt: "2026-10-05T11:55:00.000Z", stale: false },
    ]);
  });

  test("lists unclassified lines and recorder gaps", () => {
    const health = buildHealth(syntheticData(), NOW);
    expect(health.unclassified).toEqual([
      { provider: "cursor", label: "Mystery meter", lastSeenAt: "2026-10-05T11:55:00.000Z" },
    ]);
    expect(health.recorderGaps).toEqual([{ recordedAt: "2026-10-04T08:00:00.000Z", reason: "OpenUsage unreachable" }]);
  });

  test("lists stretches without Snapshots, newest first", () => {
    const health = buildHealth(syntheticData(), NOW);
    expect(health.snapshotGaps.length).toBeGreaterThan(0);
    const starts = health.snapshotGaps.map((g) => Date.parse(g.from));
    expect(starts).toEqual(starts.toSorted((a, b) => b - a));
  });
});
