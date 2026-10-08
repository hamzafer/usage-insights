// Weekly Report (`bun run report [--dry-run] [--test]`): refreshes data with the incremental
// Backfills, saves the full Report to <data dir>/reports/YYYY-MM-DD.md and sends a compact HTML card
// to Telegram, with up to 3 Suggestions from Claude (src/report/claude-suggestions.ts). launchd runs
// it Mondays at 09:00 (scripts/install-report-launchd.sh). A missing setup.md is drafted on a real
// run (`bun run setup:draft` drafts it by hand). Each outcome is recorded for the dashboard.
//   --dry-run  print the message and the Report; run no Backfill, and write, send and record nothing
//   --test     prefix the message with "[TEST] "
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { incrementalBackfills } from "../backfill/jobs.ts";
import { type Config, loadConfig } from "../config.ts";
import { AnthropicClient, readApiKey } from "../report/anthropic-client.ts";
import { ClaudeSuggestions } from "../report/claude-suggestions.ts";
import { runReport } from "../report/run.ts";
import { ensureSetup, peekSetup } from "../report/setup.ts";
import { TelegramMessenger } from "../report/telegram.ts";
import { openStore, type Store } from "../store.ts";

const FLAGS = new Set(["--dry-run", "--test"]);
const args = process.argv.slice(2);
const unknown = args.filter((a) => !FLAGS.has(a));
if (unknown.length) {
  console.error(`unknown option: ${unknown.join(" ")}\nusage: bun run report [--dry-run] [--test]`);
  process.exit(64);
}
const dryRun = args.includes("--dry-run");

// Set up inside the run (`prepare`), so a configuration or data-directory problem still sends the
// "Report failed" message (the Telegram credentials are read separately, at send time).
let config: Config | null = null;
let configError: unknown = null;
try {
  config = loadConfig();
} catch (e) {
  configError = e;
}
const cfg = (): Config => {
  if (!config) throw configError;
  return config;
};
let store: Store | null = null;
const db = () => (store ??= openStore(cfg().dbPath));
const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

try {
  const result = await runReport({
    now: () => new Date(),
    prepare: () => {
      if (!dryRun) mkdirSync(cfg().dataDir, { recursive: true });
      db();
    },
    // Only run after `prepare` succeeded, so the config is there by then.
    backfills: config ? incrementalBackfills(config, db) : [],
    load: () => ({
      readings: db().readingsWithRole(["cycle", "session", "overage"]),
      gaps: db().allGaps(),
      // All of them: the Claude calibration learns from every live Snapshot interval.
      tokens: db().tokenUsage(),
    }),
    recordRun: (outcome) => db().saveRun(outcome),
    // Token and chat id are read from the Telegram plugin's state at send time, never stored here.
    messenger: new TelegramMessenger(),
    // Claude-written Suggestions from the numbers and <data dir>/setup.md (drafted when missing, on
    // a real run only). The API key is read at call time (Keychain, or ANTHROPIC_API_KEY) and never logged.
    suggestions: {
      suggest: (report) =>
        new ClaudeSuggestions({
          client: new AnthropicClient({ apiKey: () => readApiKey(), model: cfg().suggestionsModel, url: cfg().anthropicUrl }),
          readSetup: () => {
            if (dryRun) return peekSetup(cfg().dataDir);
            const setup = ensureSetup(cfg().dataDir);
            if (setup.created) log("Drafted setup.md in the data directory (marked DRAFT)");
            return setup.text;
          },
        }).suggest(report),
    },
    save: (file, markdown) => {
      const path = join(cfg().dataDir, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, markdown);
    },
    print: (text) => console.log(text),
    log,
    dashboardUrl: config?.dashboardUrl,
    dryRun,
    test: args.includes("--test"),
  });
  if (!result.ok) process.exitCode = 1;
} catch (e) {
  log(`Report not delivered: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  (store as Store | null)?.close();
}
