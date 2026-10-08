import type { LineRole } from "../src/classify.ts";
import type { DashboardData } from "../src/dashboard/view-model.ts";
import type { Gap, StoredReading } from "../src/store.ts";
import type { Reading } from "../src/window-model.ts";

/** Synthetic readings only (ADR 0002: no real data in the repo). */
export function reading(
  provider: string,
  label: string,
  role: LineRole,
  used: number,
  resetsAt: string | null,
  fetchedAt: string,
  source = "openusage",
  limit = 100,
): Reading {
  return { provider, label, role, used, limit, resetsAt, fetchedAt, source };
}

export const NOW = "2026-10-05T12:00:00.000Z";

/**
 * codex: one ended Weekly Cycle (Waste 30%), a running one, two Sessions (one hit its limit),
 * and Workspace Credits growing after the Limit Hit.
 * claude: one ended Weekly Cycle from the Claude Backfill (Estimated, low confidence).
 */
export function syntheticReadings(): Reading[] {
  return [
    reading("codex", "Weekly", "cycle", 20, "2026-10-01T00:00:00.000Z", "2026-09-25T00:00:00.000Z"),
    reading("codex", "Weekly", "cycle", 70, "2026-10-01T00:00:00.000Z", "2026-09-30T23:50:00.000Z"),
    reading("codex", "Weekly", "cycle", 10, "2026-10-08T00:00:00.000Z", "2026-10-01T01:00:00.000Z"),
    reading("codex", "Weekly", "cycle", 40, "2026-10-08T00:00:00.000Z", "2026-10-05T11:55:00.000Z"),
    reading("codex", "Session", "session", 30, "2026-10-02T05:00:00.000Z", "2026-10-02T01:00:00.000Z"),
    reading("codex", "Session", "session", 60, "2026-10-02T05:00:00.000Z", "2026-10-02T04:50:00.000Z"),
    reading("codex", "Session", "session", 100, "2026-10-03T10:00:00.000Z", "2026-10-03T06:00:00.000Z"),
    reading("codex", "Session", "session", 100, "2026-10-03T10:00:00.000Z", "2026-10-03T09:55:00.000Z"),
    reading("codex", "Workspace Credits", "overage", 10, null, "2026-10-03T06:00:00.000Z"),
    reading("codex", "Workspace Credits", "overage", 25, null, "2026-10-03T07:00:00.000Z"),
    reading("claude", "Weekly", "cycle", 10, "2026-09-29T00:00:00.000Z", "2026-09-23T00:00:00.000Z", "backfill:claude"),
    reading("claude", "Weekly", "cycle", 55, "2026-09-29T00:00:00.000Z", "2026-09-27T00:00:00.000Z", "backfill:claude"),
  ];
}

export function stored(r: Reading, plan: string | null = null): StoredReading {
  return {
    provider: r.provider,
    label: r.label,
    role: r.role,
    used: r.used,
    limit: r.limit,
    unit: "percent",
    resetsAt: r.resetsAt,
    periodMs: null,
    plan,
    fetchedAt: r.fetchedAt,
    recordedAt: r.fetchedAt,
  };
}

export const SYNTHETIC_GAPS: Gap[] = [
  { recordedAt: "2026-10-03T08:00:00.000Z", reason: "OpenUsage timed out" },
  { recordedAt: "2026-10-04T08:00:00.000Z", reason: "OpenUsage unreachable" },
];

export function syntheticData(): DashboardData {
  const readings = [
    ...syntheticReadings(),
    reading("cursor", "Mystery meter", "unclassified", 3, null, "2026-10-05T11:55:00.000Z"),
  ];
  const latest = [...Map.groupBy(readings, (r) => `${r.provider}/${r.label}`).values()].map((line) =>
    stored(line.at(-1)!),
  );
  return { readings, latest, gaps: SYNTHETIC_GAPS };
}
