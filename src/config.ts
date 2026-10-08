import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  /** Per-user data directory, never inside the repo (ADR 0002). */
  dataDir: string;
  dbPath: string;
  openUsageUrl: string;
  /**
   * The local dashboard's address, for links (the Report). Never fails: a bad USAGE_INSIGHTS_PORT
   * falls back to the default here; only the dashboard itself validates it (`dashboardPort`).
   */
  dashboardUrl: string;
  /** Codex CLI session logs, read by the Codex Backfill. */
  codexSessionsDir: string;
  /** Claude Code `projects` directories per Provider (personal and work account), read by the token Backfill. */
  claudeProjectDirs: { provider: string; dir: string }[];
  /** Claude model for Suggestions; undefined: the built-in default (src/report/anthropic-client.ts). */
  suggestionsModel?: string;
  /** Messages API endpoint for Suggestions; undefined: the Anthropic API. */
  anthropicUrl?: string;
}

export const DEFAULT_DASHBOARD_PORT = 6740;

export const DEFAULT_OPENUSAGE_URL = "http://127.0.0.1:6736/v1/usage";

/**
 * Settings from the environment:
 * - USAGE_INSIGHTS_DATA_DIR (default `~/Library/Application Support/usage-insights`)
 * - USAGE_INSIGHTS_OPENUSAGE_URL (default `http://127.0.0.1:6736/v1/usage`)
 * - USAGE_INSIGHTS_PORT (default 6740): the dashboard's port, validated only by the dashboard
 * - USAGE_INSIGHTS_CODEX_DIR (default `~/.codex/sessions`)
 * - USAGE_INSIGHTS_CLAUDE_DIR (default `~/.claude/projects`): Provider `claude`
 * - USAGE_INSIGHTS_CLAUDE_WORK_DIR (default `~/.claude-work/projects`): Provider `claude-work`
 * - USAGE_INSIGHTS_CLAUDE_MODEL: the Claude model for Suggestions
 * - USAGE_INSIGHTS_ANTHROPIC_URL: the Messages API endpoint for Suggestions (tests)
 * (The Anthropic API key is not configuration: Keychain, or ANTHROPIC_API_KEY; see src/report/anthropic-client.ts.)
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
    dashboardUrl: `http://127.0.0.1:${portOrDefault(env.USAGE_INSIGHTS_PORT)}`,
    codexSessionsDir: env.USAGE_INSIGHTS_CODEX_DIR || join(home, ".codex", "sessions"),
    claudeProjectDirs: [
      { provider: "claude", dir: env.USAGE_INSIGHTS_CLAUDE_DIR || join(home, ".claude", "projects") },
      { provider: "claude-work", dir: env.USAGE_INSIGHTS_CLAUDE_WORK_DIR || join(home, ".claude-work", "projects") },
    ],
    suggestionsModel: env.USAGE_INSIGHTS_CLAUDE_MODEL || undefined,
    anthropicUrl: env.USAGE_INSIGHTS_ANTHROPIC_URL || undefined,
  };
}

/**
 * The dashboard's port (always bound to 127.0.0.1): USAGE_INSIGHTS_PORT, default 6740. Throws for a
 * value that is not a port. Only `bun run dashboard` calls this, so the Recorder, Backfills and
 * Report never fail on a setting they do not use.
 */
export function dashboardPort(env: Record<string, string | undefined> = process.env): number {
  const value = env.USAGE_INSIGHTS_PORT;
  if (!value) return DEFAULT_DASHBOARD_PORT;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65_535) {
    throw new Error(`USAGE_INSIGHTS_PORT must be a port number (1-65535), got "${value}"`);
  }
  return n;
}

function portOrDefault(value: string | undefined): number {
  try {
    return dashboardPort({ USAGE_INSIGHTS_PORT: value });
  } catch {
    return DEFAULT_DASHBOARD_PORT;
  }
}
