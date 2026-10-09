import { openStore, OutdatedStoreError, type Store } from "../store.ts";
import { type DashboardData, type DataNeeds, RECENT_RUNS } from "./view-model.ts";

/** Data files this process has already created or migrated: later requests open them read-only. */
const migrated = new Set<string>();

/**
 * Reads what one request needs from the store at `dbPath`, opened per request. Token rows are read
 * only as `needs` asks (everything by default), and at most once: session rows double as token rows.
 * The first request creates and migrates the file; later ones open it read-only, so a page view never
 * takes the write lock the Recorder and Backfills need.
 */
export function loadDashboardData(dbPath: string, needs: DataNeeds = { tokens: "all", sessionTokens: true }): DashboardData {
  const store = open(dbPath);
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
      tokenProviders: typeof needs.tokens === "object" && !sessionTokens ? store.tokenProviders() : undefined,
    };
  } finally {
    store.close();
  }
}

/** Read-only once migrated; a file swapped for an older version since is migrated again, once. */
function open(dbPath: string): Store {
  if (migrated.has(dbPath)) {
    try {
      return openStore(dbPath, { readonly: true });
    } catch (err) {
      if (!(err instanceof OutdatedStoreError)) throw err;
    }
  }
  const store = openStore(dbPath);
  migrated.add(dbPath);
  return store;
}
