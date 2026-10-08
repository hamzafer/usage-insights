// One recording run (`bun run record`). launchd runs this every 5 minutes; its output goes to
// <data dir>/recorder.log (scripts/install-launchd.sh).
//
// After the Snapshot, the incremental Codex and token Backfills run at most once per hour (the last
// run time is kept in the store), so new log lines are read in without a manual run.
//
// Every failure here, including configuration and opening the store, is logged and the run still
// exits 0. launchd keeps scheduling a job that exits non-zero, but repeated quick failures get it
// throttled, and a failing Recorder is no reason to stop retrying: the next run (5 minutes later)
// may succeed (spec: Error handling, "Recorder failures never crash launchd loops").
import { mkdirSync } from "node:fs";
import { incrementalBackfills, runDueBackfills } from "../backfill/jobs.ts";
import { loadConfig } from "../config.ts";
import { OpenUsageSource } from "../openusage-source.ts";
import { record } from "../recorder.ts";
import { openStore, type Store } from "../store.ts";

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

let store: Store | null = null;
try {
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });
  const db = (store = openStore(config.dbPath));
  const result = await record(new OpenUsageSource(config.openUsageUrl), db);
  if (result.ok) {
    log(`stored ${result.stored} lines`);
  } else {
    // A gap is an expected outcome, not a crash: it is stored and shown by `status`.
    log(`gap recorded: ${result.reason}`);
  }
  const ran = await runDueBackfills({ backfills: incrementalBackfills(config, () => db), store: db, now: () => new Date(), log });
  if (ran.length) log(`ran ${ran.join(", ")}`);
} catch (e) {
  log(`Recorder run failed: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  (store as Store | null)?.close();
}
