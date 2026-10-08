import { openStore } from "../store.ts";
import { type DashboardData, RECENT_RUNS } from "./view-model.ts";

/** Reads everything the dashboard shows from the store at `dbPath`, opened per request. */
export function loadDashboardData(dbPath: string): DashboardData {
  const store = openStore(dbPath);
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
