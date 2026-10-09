import { dayKey } from "./format";
import type { DataHealth, RunOutcome } from "./types";

/**
 * The header's data-health pill (#22): one state from `GET /api/health`, worst first.
 * - "failed": a Backfill or Report run failed in the last 24 hours.
 * - "gaps": the Recorder missed Snapshots today, or no Provider has a fresh Snapshot.
 * - "recording": Snapshots are coming in.
 * Shown as a status dot plus a label, never the color alone. Pure, tested with `bun test`.
 */

export type PillTone = "good" | "warning" | "critical";

export interface Pill {
  tone: PillTone;
  label: string;
  /** One sentence for the tooltip and screen readers. */
  description: string;
}

export const RECENT_FAILURE_MS = 24 * 3_600_000;

export function healthPill(health: DataHealth, now: string, timeZone?: string): Pill {
  const failed = recentFailures(health.failedRuns, now);
  if (failed.length > 0) {
    return {
      tone: "critical",
      label: failed.length === 1 ? "Run failed" : `${failed.length} runs failed`,
      description: `${failed.length === 1 ? "A Backfill or Report run" : `${failed.length} Backfill or Report runs`} failed in the last 24 hours.`,
    };
  }
  const gaps = gapsToday(health, now, timeZone);
  if (gaps > 0) {
    return {
      tone: "warning",
      label: `${gaps} ${gaps === 1 ? "gap" : "gaps"} today`,
      description: `The Recorder missed ${gaps === 1 ? "a Snapshot" : `${gaps} Snapshots`} today.`,
    };
  }
  if (health.providers.length > 0 && health.providers.every((p) => p.stale)) {
    return { tone: "warning", label: "Not recording", description: "No Snapshot in the last 30 minutes." };
  }
  if (health.providers.length === 0) {
    return { tone: "warning", label: "No data yet", description: "Nothing recorded yet: start the Recorder." };
  }
  return { tone: "good", label: "Recording", description: "Snapshots are coming in." };
}

/** Failed runs within RECENT_FAILURE_MS before now. */
export function recentFailures(runs: readonly RunOutcome[], now: string): RunOutcome[] {
  const nowMs = Date.parse(now);
  return runs.filter((r) => !r.ok && nowMs - Date.parse(r.at) <= RECENT_FAILURE_MS);
}

/** Recorder gaps on today's date in `timeZone` (the browser's by default). */
export function gapsToday(health: DataHealth, now: string, timeZone?: string): number {
  const today = dayKey(now, timeZone);
  return health.recorderGaps.filter((g) => dayKey(g.recordedAt, timeZone) === today).length;
}

/** "4 min ago", "3 h ago", "2 days ago"; "just now" under a minute. */
export function ago(iso: string, now: string): string {
  const ms = Math.max(0, Date.parse(now) - Date.parse(iso));
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/** Display names of the run jobs. */
export function jobName(job: string): string {
  return ({ "backfill:codex": "Codex Backfill", "backfill:tokens": "Token Backfill", report: "Report" } as Record<string, string>)[job] ?? job;
}

