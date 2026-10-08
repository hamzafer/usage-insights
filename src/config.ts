import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  /** Per-user data directory, never inside the repo (ADR 0002). */
  dataDir: string;
  dbPath: string;
  openUsageUrl: string;
  /** The local dashboard's port (always bound to 127.0.0.1). */
  dashboardPort: number;
}

export const DEFAULT_DASHBOARD_PORT = 6740;

export const DEFAULT_OPENUSAGE_URL = "http://127.0.0.1:6736/v1/usage";

/**
 * Settings from the environment:
 * - USAGE_INSIGHTS_DATA_DIR (default `~/Library/Application Support/usage-insights`)
 * - USAGE_INSIGHTS_OPENUSAGE_URL (default `http://127.0.0.1:6736/v1/usage`)
 * - USAGE_INSIGHTS_PORT (default 6740): the dashboard's port
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): Config {
  const dataDir =
    env.USAGE_INSIGHTS_DATA_DIR || join(home, "Library", "Application Support", "usage-insights");
  return {
    dataDir,
    dbPath: join(dataDir, "usage.db"),
    openUsageUrl: env.USAGE_INSIGHTS_OPENUSAGE_URL || DEFAULT_OPENUSAGE_URL,
    dashboardPort: port(env.USAGE_INSIGHTS_PORT),
  };
}

function port(value: string | undefined): number {
  if (!value) return DEFAULT_DASHBOARD_PORT;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65_535) {
    throw new Error(`USAGE_INSIGHTS_PORT must be a port number (1-65535), got "${value}"`);
  }
  return n;
}
