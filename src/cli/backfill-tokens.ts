// Token Backfill (`bun run backfill:tokens`): tokens per Project and model from Claude Code and Codex logs. Rerunnable.
import { mkdirSync } from "node:fs";
import { backfillTokens } from "../backfill/tokens.ts";
import { loadConfig } from "../config.ts";
import { openStore } from "../store.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const store = openStore(config.dbPath);
try {
  const result = backfillTokens({ claude: config.claudeProjectDirs, codexDir: config.codexSessionsDir, store });
  console.log(`${result.files} log files, ${result.linesRead} new lines, ${result.stored} API calls stored`);
} finally {
  store.close();
}
