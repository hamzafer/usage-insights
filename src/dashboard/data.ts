import { openStore } from "../store.ts";
import { type DashboardData, type DataNeeds, RECENT_RUNS } from "./view-model.ts";

/** Data files this process has already created or migrated: later requests open them read-only. */
const migrated = new Set<string>();

/**
 * Reads what one request needs from the store at `dbPath`, opened per request. Token rows are read
 * only as `needs` asks (all of them by default), and at most once: session rows double as token rows.
 * The first request creates and migrates the file; later ones open it read-only, so a page view never
 * takes the write lock the Recorder and Backfills need.
 */
export function loadDashboardData(dbPath: string, needs: DataNeeds = { tokens: "all" }): DashboardData {
  const store = openStore(dbPath, { readonly: migrated.has(dbPath) });
  migrated.add(dbPath);
  try {
    const sessionTokens = needs.sessionTokens ? store.sessionTokenUsage() : undefined;
    const tokens =
      sessionTokens ??
      (needs.tokens === "none" ? [] : store.tokenUsage(needs.tokens === "all" ? {} : { from: needs.tokens.from }));
    return {
      readings: store.readingsWithRole(["session", "cycle", "overage", "submeter", "ignored", "unclassified"]),
      latest: store.latestReadings(),
      gaps: store.allGaps(),
      tokens,
      runs: store.recentRuns(RECENT_RUNS),
      sessionTokens,
    };
  } finally {
    store.close();
  }
}
