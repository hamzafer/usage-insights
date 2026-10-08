// Token Backfill (`bun run backfill:tokens`): tokens per Project and model from Claude Code and Codex logs. Rerunnable.
// The Recorder also runs it once per hour; the outcome is recorded either way.
import { mkdirSync } from "node:fs";
import { TOKEN_BACKFILL_JOB } from "../backfill/jobs.ts";
import { backfillTokens } from "../backfill/tokens.ts";
import { loadConfig } from "../config.ts";
import { openStore } from "../store.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const store = openStore(config.dbPath);
try {
  const result = backfillTokens({ claude: config.claudeProjectDirs, codexDir: config.codexSessionsDir, store });
  store.saveRun({ job: TOKEN_BACKFILL_JOB, at: new Date().toISOString(), ok: true, reason: null });
  console.log(`${result.files} log files, ${result.linesRead} new lines, ${result.stored} API calls stored`);
} catch (e) {
  store.saveRun({ job: TOKEN_BACKFILL_JOB, at: new Date().toISOString(), ok: false, reason: e instanceof Error ? e.message : String(e) });
  throw e;
} finally {
  store.close();
}
