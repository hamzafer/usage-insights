import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
    expect(summary.out).toBe("codex\n  Weekly  reset 2026-01-08 09:00  Waste  25%\n");
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
    store.close();

    const summary = run("src/cli/summary.ts", deadUrl, { TZ: "UTC" });
    expect(summary.code).toBe(0);
    expect(summary.out).toContain("\n\nSessions\ncodex\n  Session  reset 2026-01-05 15:00  Waste  40%\n");
    expect(summary.out).toContain("  Idle Capacity  Weekly  reset 2026-01-08 09:00  6d 19h  97%\n");
  });

  test("with nothing recorded it says no Cycle has ended", () => {
    const summary = run("src/cli/summary.ts", deadUrl);
    expect(summary.code).toBe(0);
    expect(summary.out).toContain("No ended Cycles yet.");
  });
});
