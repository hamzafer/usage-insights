import { expect, test } from "bun:test";
import { formatLimitsOverageAndPace } from "../src/limits-summary.ts";

test("lists Limit Hits with Blocked Time, Overage per Cycle in its unit, and Pace", () => {
  const out = formatLimitsOverageAndPace(
    {
      limitHits: [
        {
          provider: "claude-work",
          label: "Session",
          role: "session",
          hitAt: "2026-10-08T12:30:00.000Z",
          blockedUntil: "2026-10-08T15:00:00.000Z",
          blockedMs: 2.5 * 3_600_000,
          endedBy: "reset",
        },
        {
          provider: "claude-work",
          label: "Weekly",
          role: "cycle",
          hitAt: "2026-10-09T10:00:00.000Z",
          blockedUntil: "2026-10-09T10:45:00.000Z",
          blockedMs: 45 * 60_000,
          endedBy: "overage",
        },
        {
          provider: "codex",
          label: "Session",
          role: "session",
          hitAt: "2026-10-10T05:00:00.000Z",
          blockedUntil: null,
          blockedMs: 3_600_000,
          endedBy: "running",
        },
      ],
      overage: [
        {
          provider: "claude-work",
          cycleLabel: "Weekly",
          cycleEndedAt: "2026-10-08T09:00:00.000Z",
          overageLabel: "Extra usage spent",
          unit: "$",
          spent: 20,
        },
        {
          provider: "codex",
          cycleLabel: "Weekly",
          cycleEndedAt: null,
          overageLabel: "Workspace Credits",
          unit: "credits",
          spent: 60,
        },
      ],
      pace: [
        {
          provider: "claude",
          label: "Weekly",
          resetsAt: "2026-10-15T00:00:00.000Z",
          lastReadingAt: "2026-10-10T00:00:00.000Z",
          projectedShare: 0.8,
          expectedWaste: 0.2,
          projectedLimitHitAt: null,
          basis: "measured",
        },
        {
          provider: "claude-work",
          label: "Weekly",
          resetsAt: "2026-10-15T00:00:00.000Z",
          lastReadingAt: "2026-10-10T00:00:00.000Z",
          projectedShare: 1,
          expectedWaste: 0,
          projectedLimitHitAt: "2026-10-12T00:00:00.000Z",
          basis: "estimated",
        },
        {
          provider: "codex",
          label: "Weekly",
          resetsAt: "2026-10-15T00:00:00.000Z",
          lastReadingAt: "2026-10-10T00:00:00.000Z",
          projectedShare: null,
          expectedWaste: null,
          projectedLimitHitAt: null,
          basis: "measured",
        },
      ],
    },
    { timeZone: "UTC" },
  );

  expect(out).toBe(
    [
      "Limit Hits",
      "  claude-work  Session  hit 2026-10-08 12:30  blocked 2h 30m until Reset",
      "  claude-work  Weekly   hit 2026-10-09 10:00  blocked 45m until Overage",
      "  codex        Session  hit 2026-10-10 05:00  blocked 1h so far",
      "",
      "Overage",
      "  claude-work  Weekly  reset 2026-10-08 09:00  Extra usage spent  $20.00",
      "  codex        Weekly  running                 Workspace Credits  60 credits",
      "",
      "Pace",
      "  claude       Weekly  reset 2026-10-15 00:00  heading for Waste  20%",
      "  claude-work  Weekly  reset 2026-10-15 00:00  heading for Waste ~ 0%  limit at 2026-10-12 00:00",
      "  codex        Weekly  reset 2026-10-15 00:00  Pace n/a (needs two readings)",
    ].join("\n"),
  );
});

test("says so when a section is empty", () => {
  expect(formatLimitsOverageAndPace({ limitHits: [], overage: [], pace: [] })).toBe(
    ["Limit Hits", "  none", "", "Overage", "  none", "", "Pace", "  no running Cycles"].join("\n"),
  );
});
