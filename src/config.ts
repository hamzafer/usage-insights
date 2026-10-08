import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  /** Per-user data directory, never inside the repo (ADR 0002). */
  dataDir: string;
  dbPath: string;
  openUsageUrl: string;
  /** Codex CLI session logs, read by the Codex Backfill. */
  codexSessionsDir: string;
}

export const DEFAULT_OPENUSAGE_URL = "http://127.0.0.1:6736/v1/usage";

/**
 * Settings from the environment:
 * - USAGE_INSIGHTS_DATA_DIR (default `~/Library/Application Support/usage-insights`)
 * - USAGE_INSIGHTS_OPENUSAGE_URL (default `http://127.0.0.1:6736/v1/usage`)
 * - USAGE_INSIGHTS_CODEX_DIR (default `~/.codex/sessions`)
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
    codexSessionsDir: env.USAGE_INSIGHTS_CODEX_DIR || join(home, ".codex", "sessions"),
  };
}
