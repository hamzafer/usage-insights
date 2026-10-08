import type { Config } from "../config.ts";
import type { Store } from "../store.ts";
import { backfillCodex } from "./codex.ts";
import { backfillTokens } from "./tokens.ts";

/**
 * The incremental Backfills as jobs, shared by the Report run and the Recorder run (which starts
 * them at most once per hour, so new log lines are read in without anyone running them by hand).
 * Each outcome is recorded in the store (spec: Error handling: failures are visible).
 */

export interface Backfill {
  name: string;
  /** The job name its outcome is recorded under; default `backfill:<name in lower case>`. */
  job?: string;
  run: () => void | Promise<void>;
}

export const CODEX_BACKFILL_JOB = "backfill:codex";
export const TOKEN_BACKFILL_JOB = "backfill:tokens";

/** How often the Recorder starts the automatic Backfills. */
export const AUTO_BACKFILL_INTERVAL_MS = 60 * 60_000;

/** The Codex and token Backfills against the store (opened lazily by `store`). */
export function incrementalBackfills(
  config: Pick<Config, "codexSessionsDir" | "claudeProjectDirs">,
  store: () => Store,
): Backfill[] {
  return [
    {
      name: "Codex",
      job: CODEX_BACKFILL_JOB,
      // Logs can hold several Codex accounts: keep the one the live Recorder tracks, when known.
      run: () => void backfillCodex({ sessionsDir: config.codexSessionsDir, store: store(), plan: store().livePlan("codex") }),
    },
    {
      name: "Token",
      job: TOKEN_BACKFILL_JOB,
      run: () => void backfillTokens({ claude: config.claudeProjectDirs, codexDir: config.codexSessionsDir, store: store() }),
    },
  ];
}

export function backfillJob(b: Backfill): string {
  return b.job ?? `backfill:${b.name.toLowerCase()}`;
}

/**
 * Runs each Backfill whose job last ran `intervalMs` or longer ago (or never), and records its
 * outcome. Never throws: a failure is recorded and logged, so the caller (the Recorder) carries on.
 * Returns the jobs that ran.
 */
export async function runDueBackfills(options: {
  backfills: readonly Backfill[];
  store: Pick<Store, "lastRunAt" | "saveRun">;
  now: () => Date;
  log: (line: string) => void;
  intervalMs?: number;
}): Promise<string[]> {
  const { backfills, store, now, log, intervalMs = AUTO_BACKFILL_INTERVAL_MS } = options;
  const ran: string[] = [];
  for (const b of backfills) {
    const job = backfillJob(b);
    try {
      const last = store.lastRunAt(job);
      if (last !== null && now().getTime() - Date.parse(last) < intervalMs) continue;
      ran.push(job);
      let error: unknown = null;
      try {
        await b.run();
      } catch (e) {
        error = e;
        log(`${b.name} Backfill failed: ${reason(e)}`);
      }
      store.saveRun({ job, at: now().toISOString(), ok: error === null, reason: error === null ? null : reason(error) });
    } catch (e) {
      log(`${b.name} Backfill not run: ${reason(e)}`);
    }
  }
  return ran;
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
