import { Glob } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { classifyLine } from "../classify.ts";
import type { Store, StoredReading } from "../store.ts";
import { readNewLines } from "./log-reader.ts";

/**
 * Codex Backfill (spec §4, Measured): rebuilds past Codex readings from the rate limits that
 * Codex CLI writes into its session logs, `<sessionsDir>/**\/rollout-*.jsonl`.
 * Each `token_count` event carries the used percent and Reset of the 5-hour and weekly windows.
 */

export const CODEX_BACKFILL_SOURCE = "backfill:codex";

export interface CodexBackfillOptions {
  sessionsDir: string;
  store: Store;
  now?: Date;
  /**
   * The plan of the account the live Recorder tracks (e.g. `Team`). Session logs can mix
   * accounts; lines that name another plan are skipped. Lines without a plan are kept.
   */
  plan?: string | null;
}

export interface CodexBackfillResult {
  /** Session log files found. */
  files: number;
  /** Complete lines read by this run (only what was appended since the last run). */
  linesRead: number;
  /** New readings stored by this run. */
  stored: number;
}

/**
 * Reads every session log from where the last run stopped and stores its readings.
 * Rerunnable: readings are unique per line and time, and a line still being written is left
 * for the next run. A file that shrank or was rewritten is read again from the start.
 */
export function backfillCodex({ sessionsDir, store, now = new Date(), plan = null }: CodexBackfillOptions): CodexBackfillResult {
  const recordedAt = now.toISOString();
  const result: CodexBackfillResult = { files: 0, linesRead: 0, stored: 0 };
  if (!existsSync(sessionsDir)) return result;

  for (const relative of new Glob("**/rollout-*.jsonl").scanSync({ cwd: sessionsDir, onlyFiles: true })) {
    result.files++;
    const read = readNewLines(store, CODEX_BACKFILL_SOURCE, join(sessionsDir, relative), relative);
    if (!read) continue;
    result.linesRead += read.lines.length;
    result.stored += store.saveReadings(read.lines.flatMap((line) => readingsOfLine(line, recordedAt, plan)));
    read.done();
  }
  return result;
}

interface RateWindow {
  used_percent?: unknown;
  window_minutes?: unknown;
  resets_at?: unknown;
}

function readingsOfLine(line: string, recordedAt: string, accountPlan: string | null): StoredReading[] {
  if (!line.includes('"token_count"')) return [];
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return [];
  }
  const limits = event?.payload?.type === "token_count" ? event.payload.rate_limits : null;
  if (!limits || typeof event.timestamp !== "string") return [];
  // Only the main Codex limit (named `codex` since 2026-03, unnamed before); `premium` and others are separate meters.
  if (limits.limit_id != null && limits.limit_id !== "codex") return [];
  const plan = typeof limits.plan_type === "string" && limits.plan_type ? capitalize(limits.plan_type) : null;
  if (plan && accountPlan && plan.toLowerCase() !== accountPlan.toLowerCase()) return [];
  const fetchedAt = new Date(event.timestamp).toISOString();
  return [limits.primary, limits.secondary].flatMap((w: RateWindow | null) => {
    const label = w ? labelOf(w.window_minutes) : null;
    if (!w || !label || typeof w.used_percent !== "number" || typeof w.resets_at !== "number") return [];
    return [
      {
        provider: "codex",
        label,
        role: classifyLine("codex", label),
        used: w.used_percent,
        limit: 100,
        unit: "percent",
        resetsAt: new Date(w.resets_at * 1000).toISOString(),
        periodMs: label === "Session" ? SESSION_MS : WEEKLY_MS,
        plan,
        fetchedAt,
        recordedAt,
        source: CODEX_BACKFILL_SOURCE,
      },
    ];
  });
}

const SESSION_MS = 300 * 60_000;
const WEEKLY_MS = 10_080 * 60_000;

/** Window lengths name the line as the live Recorder does; older logs say 299 / 10079 minutes. */
function labelOf(windowMinutes: unknown): "Session" | "Weekly" | null {
  if (typeof windowMinutes !== "number") return null;
  if (Math.abs(windowMinutes - 300) <= 1) return "Session";
  if (Math.abs(windowMinutes - 10_080) <= 1) return "Weekly";
  return null;
}

/** `team` -> `Team`, as OpenUsage names plans. */
function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
