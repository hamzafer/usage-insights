import { describe, expect, test } from "bun:test";
import { buildHealth, buildHistory, buildOverview, buildProjects, RECENT_TOKEN_CYCLES, SNAPSHOT_GAP_MS } from "../src/dashboard/view-model.ts";
import { NOW, reading, syntheticData, tokenEvent } from "./dashboard-fixtures.ts";

describe("projects and models", () => {
  test("token share per Project and model per Cycle, per Provider, newest Cycle first, folder names only", () => {
    const data = {
      ...syntheticData(),
      tokens: [
        tokenEvent("codex", "2026-09-30T10:00:00.000Z", "/somewhere/alpha", "gpt-5.5", 100),
        tokenEvent("codex", "2026-10-03T10:00:00.000Z", "/somewhere/alpha", "gpt-5.5", 300),
        tokenEvent("codex", "2026-10-03T11:00:00.000Z", null, "gpt-6-astra", 100),
      ],
    };
    const page = buildProjects(data, NOW);
    expect(page.providers.map((p) => p.provider)).toEqual(["codex"]);
    const [running, ended] = page.providers[0]!.cycles;
    expect(running).toMatchObject({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z", running: true, inferred: false, total: 400 });
    expect(running!.byProject).toEqual([
      { name: "alpha", tokens: 300, share: 0.75 },
      { name: "(other)", tokens: 100, share: 0.25 },
    ]);
    expect(running!.byModel.map((m) => m.name)).toEqual(["gpt-5.5", "gpt-6-astra"]);
    expect(ended).toMatchObject({ to: "2026-10-01T00:00:00.000Z", running: false, inferred: true, total: 100 });
    expect(JSON.stringify(page)).not.toContain("/somewhere");
  });

  test(`keeps the last ${RECENT_TOKEN_CYCLES} Cycles with tokens, and nothing without token data`, () => {
    const tokens = Array.from({ length: RECENT_TOKEN_CYCLES + 2 }, (_, i) =>
      tokenEvent("claude", new Date(Date.parse("2026-10-04T00:00:00.000Z") - i * 7 * 86_400_000).toISOString(), "/x/alpha", "claude-opus-5", 10),
    );
    expect(buildProjects({ ...syntheticData(), tokens }, NOW).providers[0]!.cycles).toHaveLength(RECENT_TOKEN_CYCLES);
    expect(buildProjects(syntheticData(), NOW).providers).toEqual([]);
  });
});

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
    // The running Cycle (10-01 00:00 to now, 108h) had two 5-hour Sessions open. Its readings are
    // hours apart, so the rest is unknown, not idle.
    const running = codex.idle[1]!;
    expect(running.idleMs).toBe(0);
    expect(running.unknownMs).toBe(98 * 3_600_000);
    expect(running.unknownShare).toBeCloseTo(98 / 108);
  });

  test("marks stretches without recorded Snapshots as gaps, up to now", () => {
    const codex = buildHistory(syntheticData(), "codex", NOW)!;
    expect(codex.gaps[0]).toEqual({ from: "2026-09-25T00:00:00.000Z", to: "2026-09-30T23:50:00.000Z" });
    expect(codex.gaps.every((g) => Date.parse(g.to) - Date.parse(g.from) > SNAPSHOT_GAP_MS)).toBe(true);
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
    // Newest first.
    expect(health.recorderGaps.map((g) => g.reason)).toEqual(["OpenUsage unreachable", "OpenUsage timed out"]);
  });

  test("lists stretches without Snapshots, newest first", () => {
    const health = buildHealth(syntheticData(), NOW);
    expect(health.snapshotGaps.length).toBeGreaterThan(0);
    const starts = health.snapshotGaps.map((g) => Date.parse(g.from));
    expect(starts).toEqual(starts.toSorted((a, b) => b - a));
  });
});

describe("Claude calibration on data health", () => {
  test("shows each Claude account calibrating, with no Estimated Waste, until live data is enough", () => {
    const data = {
      ...syntheticData(),
      readings: [
        ...syntheticData().readings,
        reading("claude", "Weekly", "cycle", 10, "2026-10-12T00:00:00.000Z", "2026-10-05T10:00:00.000Z"),
        reading("claude", "Weekly", "cycle", 12, "2026-10-12T00:00:00.000Z", "2026-10-05T11:00:00.000Z"),
      ],
      tokens: [tokenEvent("claude", "2026-10-05T10:30:00.000Z", "/x/alpha", "claude-opus-5", 5_000)],
    };
    const health = buildHealth(data, NOW);
    expect(health.calibration.map((c) => [c.provider, c.role, c.samples, c.ready])).toEqual([
      ["claude", "session", 0, false],
      ["claude", "cycle", 1, false],
    ]);
    expect(health.estimatedWaste).toEqual([]);
  });

  test("lists Estimated Waste once a calibration is ready", () => {
    const hour = (h: number) => new Date(Date.parse("2026-10-05T00:00:00.000Z") + h * 3_600_000).toISOString();
    // 12 hourly intervals of 2 points and 20k tokens each: 10k tokens per 1%.
    const readings = Array.from({ length: 13 }, (_, i) => reading("claude", "Weekly", "cycle", 10 + i * 2, "2026-10-12T00:00:00.000Z", hour(i)));
    const tokens = [
      tokenEvent("claude", "2026-09-30T00:00:00.000Z", null, "claude-opus-5", 600_000),
      ...Array.from({ length: 12 }, (_, i) => tokenEvent("claude", hour(i + 0.5), null, "claude-opus-5", 20_000)),
    ];
    const health = buildHealth({ readings, latest: [], gaps: [], tokens }, NOW);
    expect(health.calibration.find((c) => c.role === "cycle")).toMatchObject({ ready: true, tokensPerPercent: 10_000 });
    expect(health.estimatedWaste).toEqual([
      expect.objectContaining({ provider: "claude", to: "2026-10-05T00:00:00.000Z", usedShare: 0.6, share: 0.4, basis: "estimated" }),
    ]);
  });
});
