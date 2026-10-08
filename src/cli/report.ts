// Weekly Report (`bun run report [--dry-run] [--test]`): refreshes data with the incremental
// Backfills, saves the full Report to <data dir>/reports/YYYY-MM-DD.md and sends a short message
// to Telegram. launchd runs it Mondays at 09:00 (scripts/install-report-launchd.sh).
//   --dry-run  print the message and the Report; send and save nothing
//   --test     prefix the message with "[TEST] "
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { backfillCodex } from "../backfill/codex.ts";
import { backfillTokens } from "../backfill/tokens.ts";
import { loadConfig } from "../config.ts";
import { runReport } from "../report/run.ts";
import { noSuggestions } from "../report/suggestions.ts";
import { TelegramMessenger } from "../report/telegram.ts";
import { openStore, type Store } from "../store.ts";

const FLAGS = new Set(["--dry-run", "--test"]);
const args = process.argv.slice(2);
const unknown = args.filter((a) => !FLAGS.has(a));
if (unknown.length) {
  console.error(`unknown option: ${unknown.join(" ")}\nusage: bun run report [--dry-run] [--test]`);
  process.exit(64);
}

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
let store: Store | null = null;
const db = () => (store ??= openStore(config.dbPath));
const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

try {
  const result = await runReport({
    now: () => new Date(),
    backfills: [
      { name: "Codex", run: () => void backfillCodex({ sessionsDir: config.codexSessionsDir, store: db(), plan: db().livePlan("codex") }) },
      { name: "Token", run: () => void backfillTokens({ claude: config.claudeProjectDirs, codexDir: config.codexSessionsDir, store: db() }) },
    ],
    load: () => {
      const now = Date.now();
      return {
        readings: db().readingsWithRole(["cycle", "session", "overage"]),
        gaps: db().allGaps(),
        // The Report's week and the 4 weeks before it.
        tokens: db().tokenUsage({ from: new Date(now - 5 * 7 * 24 * 3_600_000).toISOString() }),
      };
    },
    // Token and chat id are read from the Telegram plugin's state at send time, never stored here.
    messenger: new TelegramMessenger(),
    // EXTENSION POINT (ticket #10): pass the Claude Suggestions provider here.
    suggestions: noSuggestions,
    save: (file, markdown) => {
      const path = join(config.dataDir, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, markdown);
    },
    print: (text) => console.log(text),
    log,
    dashboardUrl: `http://127.0.0.1:${config.dashboardPort}`,
    dryRun: args.includes("--dry-run"),
    test: args.includes("--test"),
  });
  if (!result.ok) process.exitCode = 1;
} catch (e) {
  log(`Report not delivered: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  (store as Store | null)?.close();
}
