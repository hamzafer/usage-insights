import { openStore } from "../store.ts";
import type { DashboardData } from "./view-model.ts";

/** Reads everything the dashboard shows from the store at `dbPath`, opened per request. */
export function loadDashboardData(dbPath: string): DashboardData {
  const store = openStore(dbPath);
  try {
    return {
      readings: store.readingsWithRole(["session", "cycle", "overage", "submeter", "ignored", "unclassified"]),
      latest: store.latestReadings(),
      gaps: store.allGaps(),
    };
  } finally {
    store.close();
  }
}
