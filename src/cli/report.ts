// Weekly Report (`bun run report [--dry-run] [--test]`): refreshes data with the incremental
// Backfills, saves the full Report to <data dir>/reports/YYYY-MM-DD.md and sends a compact HTML card
// to Telegram, with up to 3 Suggestions from Claude (src/report/claude-suggestions.ts). launchd runs
// it Mondays at 09:00 (scripts/install-report-launchd.sh). A missing setup.md is drafted, even on
// --dry-run.
//   --dry-run  print the message and the Report; send and save nothing
//   --test     prefix the message with "[TEST] "
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { backfillCodex } from "../backfill/codex.ts";
import { backfillTokens } from "../backfill/tokens.ts";
import { loadConfig } from "../config.ts";
import { runReport } from "../report/run.ts";
import { AnthropicClient, readApiKey } from "../report/anthropic-client.ts";
import { ClaudeSuggestions } from "../report/claude-suggestions.ts";
import { ensureSetup } from "../report/setup.ts";
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
    load: () => ({
      readings: db().readingsWithRole(["cycle", "session", "overage"]),
      gaps: db().allGaps(),
      // All of them: the Claude calibration learns from every live Snapshot interval.
      tokens: db().tokenUsage(),
    }),
    // Token and chat id are read from the Telegram plugin's state at send time, never stored here.
    messenger: new TelegramMessenger(),
    // Claude-written Suggestions from the numbers and <data dir>/setup.md (drafted when missing).
    // The API key is read at call time (Keychain, or ANTHROPIC_API_KEY) and never logged.
    suggestions: new ClaudeSuggestions({
      client: new AnthropicClient({ apiKey: () => readApiKey(), model: config.suggestionsModel, url: config.anthropicUrl }),
      readSetup: () => {
        const setup = ensureSetup(config.dataDir);
        if (setup.created) log("Drafted setup.md in the data directory (marked DRAFT)");
        return setup.text;
      },
    }),
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
