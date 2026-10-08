// Ended Cycles per Provider with their Waste (`bun run summary`).
import { mkdirSync } from "node:fs";
import { loadConfig } from "../config.ts";
import { formatLimitsOverageAndPace, limitsOverageAndPace } from "../limits-summary.ts";
import { openStore } from "../store.ts";
import { formatSummary } from "../summary.ts";
import { deriveWindows } from "../window-model.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const store = openStore(config.dbPath);
try {
  console.log(formatSummary(deriveWindows(store.readingsWithRole(["cycle"]), new Date())));
  const limits = limitsOverageAndPace(store.readingsWithRole(["session", "cycle", "overage"]), new Date());
  console.log(`\n${formatLimitsOverageAndPace(limits)}`);
} finally {
  store.close();
}
