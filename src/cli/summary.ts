// Ended Cycles per Provider with their Waste, then Sessions and Idle Capacity (`bun run summary`).
import { mkdirSync } from "node:fs";
import { loadConfig } from "../config.ts";
import { formatLimitsOverageAndPace, limitsOverageAndPace } from "../limits-summary.ts";
import { openStore } from "../store.ts";
import { formatSessions, formatSummary } from "../summary.ts";
import { deriveWindows } from "../window-model.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const store = openStore(config.dbPath);
try {
  const now = new Date();
  const readings = store.readingsWithRole(["cycle", "session", "overage"]);
  const windows = deriveWindows(
    readings.filter((r) => r.role === "cycle" || r.role === "session"),
    now,
  );
  console.log(formatSummary(windows));
  const sessions = formatSessions(windows, now, { gaps: store.allGaps() });
  if (sessions) console.log(`\n${sessions}`);
  console.log(`\n${formatLimitsOverageAndPace(limitsOverageAndPace(readings, now))}`);
} finally {
  store.close();
}
