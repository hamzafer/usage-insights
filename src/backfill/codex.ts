import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyLine } from "../classify.ts";
import type { Store, StoredReading } from "../store.ts";

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
}

export interface CodexBackfillResult {
  /** New readings stored by this run. */
  stored: number;
}

export function backfillCodex({ sessionsDir, store, now = new Date() }: CodexBackfillOptions): CodexBackfillResult {
  const recordedAt = now.toISOString();
  let stored = 0;
  for (const relative of new Glob("**/rollout-*.jsonl").scanSync({ cwd: sessionsDir, onlyFiles: true })) {
    const text = readFileSync(join(sessionsDir, relative), "utf8");
    const readings = text.split("\n").flatMap((line) => readingsOfLine(line, recordedAt));
    stored += store.saveReadings(readings);
  }
  return { stored };
}

interface RateWindow {
  used_percent?: unknown;
  window_minutes?: unknown;
  resets_at?: unknown;
}

function readingsOfLine(line: string, recordedAt: string): StoredReading[] {
  if (!line.includes('"token_count"')) return [];
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return [];
  }
  const limits = event?.payload?.type === "token_count" ? event.payload.rate_limits : null;
  if (!limits || typeof event.timestamp !== "string") return [];
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
        plan: null,
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
