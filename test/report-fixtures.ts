import type { ReportInput } from "../src/report/build.ts";
import type { TokenEvent } from "../src/store.ts";
import type { Reading } from "../src/window-model.ts";

/** Synthetic data for Report tests (no real usage). The Report's week is 2026-10-05 09:00 to 2026-10-12 09:00 UTC. */
export const NOW = "2026-10-12T09:00:00.000Z";

const codexWeekly = (used: number, resetsAt: string, fetchedAt: string): Reading => ({
  provider: "codex",
  label: "Weekly",
  role: "cycle",
  used,
  limit: 100,
  resetsAt,
  fetchedAt,
  source: "openusage",
});

const claudeSession = (used: number, resetsAt: string | null, fetchedAt: string): Reading => ({
  provider: "claude",
  label: "Session",
  role: "session",
  used,
  limit: 100,
  resetsAt,
  fetchedAt,
  source: "openusage",
});

const extraUsage = (used: number, fetchedAt: string): Reading => ({
  provider: "claude-work",
  label: "Extra usage spent",
  role: "overage",
  used,
  limit: 50,
  resetsAt: null,
  fetchedAt,
  source: "openusage",
});

export const readings: Reading[] = [
  // Two earlier Cycles: Waste 50% (reset 09-24) and 30% (reset 10-01, last reading 13h before: low confidence).
  codexWeekly(40, "2026-09-24T09:00:00.000Z", "2026-09-20T09:00:00.000Z"),
  codexWeekly(50, "2026-09-24T09:00:00.000Z", "2026-09-24T08:50:00.000Z"),
  codexWeekly(10, "2026-10-01T09:00:00.000Z", "2026-09-24T10:00:00.000Z"),
  codexWeekly(70, "2026-10-01T09:00:00.000Z", "2026-09-30T20:00:00.000Z"),
  // The Cycle that reset this week: Waste 20%.
  codexWeekly(60, "2026-10-08T09:00:00.000Z", "2026-10-07T08:00:00.000Z"),
  codexWeekly(80, "2026-10-08T09:00:00.000Z", "2026-10-08T08:45:00.000Z"),
  // The running Cycle: 10% at 10-08 12:00, 40% at 10-11 12:00 (10% a day), Reset 10-15 09:00.
  codexWeekly(10, "2026-10-15T09:00:00.000Z", "2026-10-08T12:00:00.000Z"),
  codexWeekly(40, "2026-10-15T09:00:00.000Z", "2026-10-11T12:00:00.000Z"),
  // A Session Limit Hit at 10:00, blocked until its Reset at 12:00; the next Session never started.
  claudeSession(60, "2026-10-10T12:00:00.000Z", "2026-10-10T08:00:00.000Z"),
  claudeSession(100, "2026-10-10T12:00:00.000Z", "2026-10-10T10:00:00.000Z"),
  claudeSession(100, "2026-10-10T12:00:00.000Z", "2026-10-10T10:05:00.000Z"),
  claudeSession(0, null, "2026-10-10T12:05:00.000Z"),
  // Overage: $7.50 then $7.50 more this week.
  extraUsage(5, "2026-10-04T09:00:00.000Z"),
  extraUsage(12.5, "2026-10-09T10:00:00.000Z"),
  extraUsage(20, "2026-10-11T10:00:00.000Z"),
];

const tokens = (at: string, provider: string, project: string | null, model: string, total: number): TokenEvent => ({
  provider,
  at,
  project,
  model,
  input: total / 2,
  cacheWrite: 0,
  cacheRead: total / 4,
  output: total / 4,
});

export const tokenEvents: TokenEvent[] = [
  tokens("2026-09-20T10:00:00.000Z", "codex", "/repos/alpha", "gpt-5-codex", 400_000),
  tokens("2026-10-06T10:00:00.000Z", "claude", "/repos/alpha", "claude-sonnet", 600_000),
  tokens("2026-10-07T10:00:00.000Z", "claude", "/repos/beta", "claude-opus", 200_000),
  tokens("2026-10-09T10:00:00.000Z", "codex", "/repos/alpha", "gpt-5-codex", 120_000),
  tokens("2026-10-10T10:00:00.000Z", "claude", null, "claude-sonnet", 80_000),
];

export const input: ReportInput = {
  readings,
  gaps: [{ recordedAt: "2026-10-09T03:00:00.000Z" }],
  tokens: tokenEvents,
  now: NOW,
};
