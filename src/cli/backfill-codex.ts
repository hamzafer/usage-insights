// Codex Backfill (`bun run backfill:codex`): past Codex readings from its session logs. Rerunnable.
import { mkdirSync } from "node:fs";
import { backfillCodex } from "../backfill/codex.ts";
import { loadConfig } from "../config.ts";
import { openStore } from "../store.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const store = openStore(config.dbPath);
try {
  // Logs can hold several Codex accounts: keep the one the live Recorder tracks, when known.
  const result = backfillCodex({ sessionsDir: config.codexSessionsDir, store, plan: store.livePlan("codex") });
  console.log(`${result.files} log files, ${result.linesRead} new lines, ${result.stored} readings stored`);
} finally {
  store.close();
}
