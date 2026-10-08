import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

function run(script: string, openUsageUrl: string) {
  const proc = Bun.spawnSync(["bun", "run", script], {
    cwd: root,
    env: {
      ...process.env,
      USAGE_INSIGHTS_DATA_DIR: dataDir,
      USAGE_INSIGHTS_OPENUSAGE_URL: openUsageUrl,
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
