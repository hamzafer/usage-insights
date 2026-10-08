import { openStore } from "../store.ts";
import { type DashboardData, RECENT_RUNS } from "./view-model.ts";

/** Data files this process has already created or migrated: later requests open them read-only. */
const migrated = new Set<string>();

/**
 * Reads everything the dashboard shows from the store at `dbPath`, opened per request. The first
 * request creates and migrates the file; later ones open it read-only, so a page view never
 * takes the write lock the Recorder and Backfills need.
 */
export function loadDashboardData(dbPath: string): DashboardData {
  const store = openStore(dbPath, { readonly: migrated.has(dbPath) });
  migrated.add(dbPath);
  try {
    return {
      readings: store.readingsWithRole(["session", "cycle", "overage", "submeter", "ignored", "unclassified"]),
      latest: store.latestReadings(),
      gaps: store.allGaps(),
      tokens: store.tokenUsage(),
      runs: store.recentRuns(RECENT_RUNS),
    };
  } finally {
    store.close();
  }
}
