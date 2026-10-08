// One recording run (`bun run record`). launchd runs this every 5 minutes.
import { mkdirSync } from "node:fs";
import { loadConfig } from "../config.ts";
import { OpenUsageSource } from "../openusage-source.ts";
import { record } from "../recorder.ts";
import { openStore } from "../store.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const store = openStore(config.dbPath);
try {
  const result = await record(new OpenUsageSource(config.openUsageUrl), store);
  const stamp = new Date().toISOString();
  if (result.ok) {
    console.log(`${stamp} stored ${result.stored} lines`);
  } else {
    // A gap is an expected outcome, not a crash: it is stored and shown by `status`.
    console.log(`${stamp} gap recorded: ${result.reason}`);
  }
} finally {
  store.close();
}
