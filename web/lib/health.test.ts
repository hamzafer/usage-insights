import { describe, expect, test } from "bun:test";
import { ago, gapsToday, healthPill, jobName } from "./health";
import type { DataHealth } from "./types";

// Synthetic values only.
const NOW = "2026-10-05T12:00:00.000Z";
const TZ = "UTC";

function health(over: Partial<DataHealth> = {}): DataHealth {
  return {
    providers: [{ provider: "codex", lastSnapshotAt: "2026-10-05T11:55:00.000Z", stale: false }],
    unclassified: [],
    recorderGaps: [],
    failedRuns: [],
    snapshotGaps: [],
    calibration: [],
    ...over,
  };
}

describe("healthPill", () => {
  test("recording when Snapshots come in", () => {
    expect(healthPill(health(), NOW, TZ)).toMatchObject({ tone: "good", label: "Recording" });
  });

  test("counts today's recorder gaps only", () => {
    const gaps = [
      { recordedAt: "2026-10-05T09:00:00.000Z", reason: "OpenUsage unreachable" },
      { recordedAt: "2026-10-05T01:00:00.000Z", reason: "OpenUsage timed out" },
      { recordedAt: "2026-10-04T23:00:00.000Z", reason: "OpenUsage timed out" },
    ];
    expect(gapsToday(health({ recorderGaps: gaps }), NOW, TZ)).toBe(2);
    expect(healthPill(health({ recorderGaps: gaps }), NOW, TZ)).toMatchObject({ tone: "warning", label: "2 gaps today" });
    expect(healthPill(health({ recorderGaps: gaps.slice(0, 1) }), NOW, TZ).label).toBe("1 gap today");
  });

  test("a failed run in the last 24 hours wins over gaps; older failures do not count", () => {
    const failedRuns = [{ job: "report", at: "2026-10-05T10:00:00.000Z", ok: false, reason: "HTTP 401" }];
    const gaps = [{ recordedAt: "2026-10-05T09:00:00.000Z", reason: "x" }];
    expect(healthPill(health({ failedRuns, recorderGaps: gaps }), NOW, TZ)).toMatchObject({ tone: "critical", label: "Run failed" });
    const old = [{ job: "report", at: "2026-10-03T10:00:00.000Z", ok: false, reason: "HTTP 401" }];
    expect(healthPill(health({ failedRuns: old }), NOW, TZ).tone).toBe("good");
  });

  test("not recording when every Provider is stale; no data yet when there are none", () => {
    const stale = [{ provider: "codex", lastSnapshotAt: "2026-10-04T00:00:00.000Z", stale: true }];
    expect(healthPill(health({ providers: stale }), NOW, TZ).label).toBe("Not recording");
    expect(healthPill(health({ providers: [] }), NOW, TZ).label).toBe("No data yet");
  });
});

describe("helpers", () => {
  test("ago and job names", () => {
    expect(ago("2026-10-05T11:59:40.000Z", NOW)).toBe("just now");
    expect(ago("2026-10-05T11:55:00.000Z", NOW)).toBe("5 min ago");
    expect(ago("2026-10-05T09:00:00.000Z", NOW)).toBe("3 h ago");
    expect(ago("2026-10-01T12:00:00.000Z", NOW)).toBe("4 days ago");
    expect(jobName("backfill:codex")).toBe("Codex Backfill");
    expect(jobName("other")).toBe("other");
  });
});
