// Codex Backfill (`bun run backfill:codex`): past Codex readings from its session logs. Rerunnable.
// The Recorder also runs it once per hour; the outcome is recorded either way.
import { mkdirSync } from "node:fs";
import { backfillCodex } from "../backfill/codex.ts";
import { CODEX_BACKFILL_JOB } from "../backfill/jobs.ts";
import { loadConfig } from "../config.ts";
import { openStore } from "../store.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const store = openStore(config.dbPath);
try {
  // Logs can hold several Codex accounts: keep the one the live Recorder tracks, when known.
  const result = backfillCodex({ sessionsDir: config.codexSessionsDir, store, plan: store.livePlan("codex") });
  store.saveRun({ job: CODEX_BACKFILL_JOB, at: new Date().toISOString(), ok: true, reason: null });
  console.log(`${result.files} log files, ${result.linesRead} new lines, ${result.stored} readings stored`);
} catch (e) {
  store.saveRun({ job: CODEX_BACKFILL_JOB, at: new Date().toISOString(), ok: false, reason: e instanceof Error ? e.message : String(e) });
  throw e;
} finally {
  store.close();
}
