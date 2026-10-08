import { describe, expect, test } from "bun:test";
import { findLimitHits } from "../src/limits.ts";
import { deriveWindows, type Reading } from "../src/window-model.ts";

function reading(at: string, used: number, resetsAt: string | null, over: Partial<Reading> = {}): Reading {
  return {
    provider: "claude-work",
    label: "Session",
    role: "session",
    used,
    limit: 100,
    resetsAt,
    fetchedAt: at,
    source: "openusage",
    ...over,
  };
}

const NOW = "2026-10-10T00:00:00.000Z";
const RESET = "2026-10-08T15:00:00.000Z";

describe("Limit Hits", () => {
  test("a Window reaching 100% is a Limit Hit, blocked until its Reset", () => {
    const windows = deriveWindows(
      [
        reading("2026-10-08T10:00:00.000Z", 40, RESET),
        reading("2026-10-08T12:30:00.000Z", 100, RESET),
        reading("2026-10-08T13:00:00.000Z", 100, RESET),
        reading("2026-10-08T15:05:00.000Z", 0, "2026-10-08T20:05:00.000Z"),
      ],
      NOW,
    );

    expect(findLimitHits(windows, [], NOW)).toEqual([
      {
        provider: "claude-work",
        label: "Session",
        role: "session",
        hitAt: "2026-10-08T12:30:00.000Z",
        blockedUntil: RESET,
        blockedMs: 2.5 * 3_600_000,
        endedBy: "reset",
      },
    ]);
  });

  test("Blocked Time stops when the same Provider's Overage starts growing", () => {
    const windows = deriveWindows(
      [
        reading("2026-10-08T12:30:00.000Z", 100, RESET),
        reading("2026-10-08T15:05:00.000Z", 0, "2026-10-08T20:05:00.000Z"),
      ],
      NOW,
    );
    const spent = (at: string, used: number, provider = "claude-work"): Reading =>
      reading(at, used, null, { provider, label: "Extra usage spent", role: "overage", limit: 200 });
    const overage = [
      spent("2026-10-08T12:00:00.000Z", 5),
      spent("2026-10-08T13:00:00.000Z", 5),
      spent("2026-10-08T13:00:00.000Z", 9, "cursor"),
      spent("2026-10-08T13:30:00.000Z", 7.5),
      spent("2026-10-08T14:00:00.000Z", 12),
    ];

    expect(findLimitHits(windows, overage, NOW)).toEqual([
      expect.objectContaining({
        hitAt: "2026-10-08T12:30:00.000Z",
        blockedUntil: "2026-10-08T13:30:00.000Z",
        blockedMs: 3_600_000,
        endedBy: "overage",
      }),
    ]);
  });

  test("Overage that only drops (its own reset) does not end Blocked Time", () => {
    const windows = deriveWindows([reading("2026-10-08T12:30:00.000Z", 100, RESET)], NOW);
    const credits = (at: string, used: number): Reading =>
      reading(at, used, null, { label: "Workspace Credits", role: "overage", limit: 500 });

    expect(
      findLimitHits(windows, [credits("2026-10-08T12:00:00.000Z", 300), credits("2026-10-08T13:00:00.000Z", 0)], NOW),
    ).toEqual([expect.objectContaining({ blockedUntil: RESET, endedBy: "reset" })]);
  });

  test("a Limit Hit in a running Window is still blocked, counted up to now", () => {
    const now = "2026-10-08T14:00:00.000Z";
    const windows = deriveWindows([reading("2026-10-08T12:30:00.000Z", 100, RESET)], now);

    expect(findLimitHits(windows, [], now)).toEqual([
      expect.objectContaining({ blockedUntil: null, blockedMs: 1.5 * 3_600_000, endedBy: "running" }),
    ]);
  });

  test("a Window that stays below its limit has no Limit Hit", () => {
    const windows = deriveWindows(
      [reading("2026-10-08T10:00:00.000Z", 40, RESET), reading("2026-10-08T14:00:00.000Z", 99.5, RESET)],
      NOW,
    );
    expect(findLimitHits(windows, [], NOW)).toEqual([]);
  });
});
