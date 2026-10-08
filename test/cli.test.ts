import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.ts";

// End to end through the package scripts' entry points, always in a temp data directory.
const fixture = await Bun.file(new URL("./fixtures/openusage-v1-usage.json", import.meta.url)).text();
const server = Bun.serve({ port: 0, fetch: () => new Response(fixture) });
afterAll(() => server.stop(true));

const root = new URL("..", import.meta.url).pathname;
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "usage-insights-test-"));
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

function run(script: string, openUsageUrl: string, extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawnSync(["bun", "run", script], {
    cwd: root,
    env: {
      ...process.env,
      USAGE_INSIGHTS_DATA_DIR: dataDir,
      USAGE_INSIGHTS_OPENUSAGE_URL: openUsageUrl,
      ...extraEnv,
    },
  });
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

const liveUrl = () => `http://127.0.0.1:${server.port}/v1/usage`;
const deadUrl = "http://127.0.0.1:9/v1/usage";

describe("record and status", () => {
  test("record stores a Snapshot and status shows the latest reading per line", () => {
    const recorded = run("src/cli/record.ts", liveUrl());
    expect(recorded.code).toBe(0);
    expect(recorded.out).toContain("stored 14 lines");

    const status = run("src/cli/status.ts", liveUrl());
    expect(status.code).toBe(0);
    expect(status.out).toContain("claude");
    expect(status.out).toMatch(/Session\s+session\s+25 \/ 100 percent/);
    expect(status.out).toMatch(/Workspace Credits\s+overage\s+10 \/ 100 credits/);
    expect(status.out).toContain("No gaps recorded.");
  });

  test("record with OpenUsage down stores a gap that status lists", () => {
    const recorded = run("src/cli/record.ts", deadUrl);
    expect(recorded.code).toBe(0);
    expect(recorded.out).toContain("gap recorded");

    const status = run("src/cli/status.ts", deadUrl);
    expect(status.out).toContain("No Snapshots recorded yet.");
    expect(status.out).toContain("Recent gaps");
  });
});

describe("summary", () => {
  test("lists ended Cycles with their Waste from stored readings", () => {
    const store = openStore(join(dataDir, "usage.db"));
    const weekly = {
      provider: "codex",
      label: "Weekly",
      role: "cycle" as const,
      limit: 100,
      unit: "percent",
      periodMs: 604_800_000,
      plan: null,
      recordedAt: "2026-01-05T10:00:05.000Z",
    };
    store.saveReadings([
      { ...weekly, used: 20, resetsAt: "2026-01-08T09:00:00.123Z", fetchedAt: "2026-01-05T10:00:00.000Z" },
      { ...weekly, used: 75, resetsAt: "2026-01-08T08:59:59.870Z", fetchedAt: "2026-01-08T08:50:00.000Z" },
      { ...weekly, used: 0, resetsAt: "2099-01-01T09:00:00.000Z", fetchedAt: "2026-01-08T09:05:00.000Z" },
    ]);
    store.close();

    const summary = run("src/cli/summary.ts", deadUrl, { TZ: "UTC" });
    expect(summary.code).toBe(0);
    expect(summary.out).toStartWith("codex\n  Weekly  reset 2026-01-08 09:00  Waste  25%\n");
  });

  test("adds Limit Hits, Overage and Pace from stored Session, Cycle and Overage readings", () => {
    const store = openStore(join(dataDir, "usage.db"));
    const line = { provider: "claude-work", unit: "percent", periodMs: null, plan: null, recordedAt: "2026-01-05T10:00:05.000Z" };
    store.saveReadings([
      { ...line, label: "Session", role: "session", used: 100, limit: 100, resetsAt: "2026-01-05T12:00:00.000Z", fetchedAt: "2026-01-05T10:00:00.000Z" },
      { ...line, label: "Extra usage spent", role: "overage", unit: "dollars", used: 1, limit: 200, resetsAt: null, fetchedAt: "2026-01-05T10:00:00.000Z" },
      { ...line, label: "Extra usage spent", role: "overage", unit: "dollars", used: 3.5, limit: 200, resetsAt: null, fetchedAt: "2026-01-05T10:30:00.000Z" },
    ]);
    store.close();

    const summary = run("src/cli/summary.ts", deadUrl, { TZ: "UTC" });
    expect(summary.code).toBe(0);
    expect(summary.out).toContain("Limit Hits\n  claude-work  Session  hit 2026-01-05 10:00  blocked 30m until Overage\n");
    expect(summary.out).toContain("Pace\n  no running Cycles\n");
  });

  test("adds a Sessions section with Session Waste and Idle Capacity", () => {
    const store = openStore(join(dataDir, "usage.db"));
    const line = {
      provider: "codex",
      limit: 100,
      unit: "percent",
      plan: null,
      recordedAt: "2026-01-05T10:00:05.000Z",
    };
    const weekly = { ...line, label: "Weekly", role: "cycle" as const, periodMs: 604_800_000 };
    const session = { ...line, label: "Session", role: "session" as const, periodMs: 18_000_000 };
    store.saveReadings([
      { ...weekly, used: 20, resetsAt: "2026-01-08T09:00:00.000Z", fetchedAt: "2026-01-01T09:00:00.000Z" },
      { ...weekly, used: 75, resetsAt: "2026-01-08T09:00:00.000Z", fetchedAt: "2026-01-08T08:50:00.000Z" },
      { ...weekly, used: 0, resetsAt: "2099-01-01T09:00:00.000Z", fetchedAt: "2026-01-08T09:05:00.000Z" },
      { ...session, used: 60, resetsAt: "2026-01-05T15:00:00.000Z", fetchedAt: "2026-01-05T14:50:00.000Z" },
      { ...session, used: 0, resetsAt: null, fetchedAt: "2026-01-06T10:00:00.000Z" },
    ]);
    // A recorder run that failed between the two readings around the Reset.
    store.saveGap({ recordedAt: "2026-01-08T08:55:00.000Z", reason: "OpenUsage unreachable" });
    store.close();

    const summary = run("src/cli/summary.ts", deadUrl, { TZ: "UTC" });
    expect(summary.code).toBe(0);
    expect(summary.out).toContain("\n\nSessions\ncodex\n  Session  reset 2026-01-05 15:00  Waste  40%\n");
    // Only the Session's 5 hours are known; the rest of the Cycle is unknown, not idle.
    expect(summary.out).toContain("  Idle Capacity  Weekly  reset 2026-01-08 09:00  0m   0%  unknown 6d 19h\n");
  });

  test("with nothing recorded it says no Cycle has ended", () => {
    const summary = run("src/cli/summary.ts", deadUrl);
    expect(summary.code).toBe(0);
    expect(summary.out).toContain("No ended Cycles yet.");
  });
});

describe("backfill:codex", () => {
  test("rebuilds past Codex Cycles from session logs so summary shows their Waste, and reruns add nothing", () => {
    // Synthetic log: a Weekly Cycle ending 2026-01-08 09:00 UTC at 70% used, then a new one.
    const codexDir = join(dataDir, "codex-sessions");
    const day = join(codexDir, "2026", "01", "08");
    mkdirSync(day, { recursive: true });
    const line = (at: string, used: number, resetIso: string) =>
      JSON.stringify({
        timestamp: at,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: null,
          rate_limits: {
            limit_id: "codex",
            primary: { used_percent: 5, window_minutes: 300, resets_at: Date.parse(at) / 1000 + 3600 },
            secondary: { used_percent: used, window_minutes: 10080, resets_at: Date.parse(resetIso) / 1000 },
            plan_type: "plus",
          },
        },
      });
    writeFileSync(
      join(day, "rollout-2026-01-08T09-00-00-synthetic.jsonl"),
      [
        line("2026-01-07T10:00:00.000Z", 40, "2026-01-08T09:00:00Z"),
        line("2026-01-08T08:50:00.000Z", 70, "2026-01-08T09:00:00Z"),
        line("2026-01-08T09:10:00.000Z", 1, "2099-01-01T09:00:00Z"),
      ].join("\n") + "\n",
    );
    const env = { USAGE_INSIGHTS_CODEX_DIR: codexDir, TZ: "UTC" };

    const first = run("src/cli/backfill-codex.ts", deadUrl, env);
    expect(first.code).toBe(0);
    expect(first.out).toContain("1 log files, 3 new lines, 6 readings stored");
    expect(run("src/cli/backfill-codex.ts", deadUrl, env).out).toContain("1 log files, 0 new lines, 0 readings stored");

    const summary = run("src/cli/summary.ts", deadUrl, env);
    expect(summary.out).toStartWith("codex\n  Weekly  reset 2026-01-08 09:00  Waste  30%\n");
  });

  test("with no Codex logs it stores nothing and says so", () => {
    const out = run("src/cli/backfill-codex.ts", deadUrl, { USAGE_INSIGHTS_CODEX_DIR: join(dataDir, "missing") });
    expect(out.code).toBe(0);
    expect(out.out).toContain("0 log files");
  });
});
