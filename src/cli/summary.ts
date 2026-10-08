// Ended Cycles per Provider with their Waste, then Sessions and Idle Capacity (`bun run summary`).
import { mkdirSync } from "node:fs";
import { loadConfig } from "../config.ts";
import { openStore } from "../store.ts";
import { formatSessions, formatSummary } from "../summary.ts";
import { deriveWindows } from "../window-model.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const store = openStore(config.dbPath);
try {
  const now = new Date();
  const windows = deriveWindows(store.readingsWithRole(["cycle", "session"]), now);
  console.log(formatSummary(windows));
  const sessions = formatSessions(windows, now);
  if (sessions) console.log(`\n${sessions}`);
} finally {
  store.close();
}
