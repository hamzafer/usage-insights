import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDashboardData } from "../src/dashboard/data.ts";
import { dashboardHandler } from "../src/dashboard/server.ts";
import { openStore } from "../src/store.ts";
import { NOW, reading, stored, SYNTHETIC_GAPS, syntheticReadings } from "./dashboard-fixtures.ts";

// Handlers over a real store in a temp data directory, seeded with synthetic readings.
let dataDir: string;
let dbPath: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "usage-insights-dashboard-"));
  dbPath = join(dataDir, "usage.db");
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

function seed() {
  const store = openStore(dbPath);
  store.saveReadings([
    ...syntheticReadings().filter((r) => r.source === "openusage").map((r) => stored(r)),
    stored(reading("cursor", "Mystery meter", "unclassified", 3, null, "2026-10-05T11:55:00.000Z")),
  ]);
  for (const gap of SYNTHETIC_GAPS) store.saveGap(gap);
  store.close();
}

function handler() {
  return dashboardHandler({ load: () => loadDashboardData(dbPath), now: () => new Date(NOW), timeZone: "UTC" });
}

async function get(path: string, method = "GET") {
  const res = await handler()(new Request(`http://127.0.0.1:6740${path}`, { method }));
  return { status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text() };
}

describe("pages", () => {
  test("overview shows each Provider's last Cycle Waste, Limit Hits and Overage", async () => {
    seed();
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.type).toContain("text/html");
    expect(res.body).toContain("Codex");
    expect(res.body).toContain("30%"); // last Cycle Waste
    expect(res.body).toContain("15 credits"); // Overage in its own unit
    expect(res.body).toContain("blocked 1h in total");
    expect(res.body).toContain("Pace: heading for");
  });

  test("overview flags data problems and links to data health", async () => {
    seed();
    const { body } = await get("/");
    expect(body).toContain("1 unclassified line");
    expect(body).toContain('href="/health"');
  });

  test("overview of an empty data directory explains how to start recording", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.body).toContain("No Cycles recorded yet");
  });

  test("Provider history shows Waste per Cycle and Session, Idle Capacity and gaps", async () => {
    seed();
    const res = await get("/provider/codex");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Waste per Cycle");
    expect(res.body).toContain("Waste per Session");
    expect(res.body).toContain("Idle Capacity per Cycle");
    expect(res.body).toContain('class="gap"');
    expect(res.body).toContain("No Snapshots 25 Sep 00:00 to 30 Sep 23:50");
  });

  test("an unknown Provider is a 404 page", async () => {
    seed();
    const res = await get("/provider/nobody");
    expect(res.status).toBe(404);
    expect(res.body).toContain("No data for this Provider");
  });

  test("data health lists unclassified lines, recorder gaps and last Snapshots", async () => {
    seed();
    const res = await get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toContain("Mystery meter");
    expect(res.body).toContain("OpenUsage unreachable");
    expect(res.body).toContain("5 Oct 11:55");
  });

  test("Estimated Waste is marked ~", async () => {
    // Claude Backfill readings, straight from the fixture (the store write path for them is #5's).
    const readings = syntheticReadings().filter((r) => r.provider === "claude");
    const data = { readings, latest: [], gaps: [] };
    const res = await dashboardHandler({ load: () => data, now: () => new Date(NOW), timeZone: "UTC" })(
      new Request("http://127.0.0.1/"),
    );
    const body = await res.text();
    expect(body).toContain("~45%");
    expect(body).toContain("low confidence");
  });

  test("unknown paths are 404 and other methods are 405", async () => {
    expect((await get("/nope")).status).toBe(404);
    expect((await get("/", "POST")).status).toBe(405);
  });

  test("a failing data load is a loud 500, not an empty page", async () => {
    const failing = dashboardHandler({
      load: () => {
        throw new Error("database is locked");
      },
      now: () => new Date(NOW),
      log: () => {},
    });
    const res = await failing(new Request("http://127.0.0.1/"));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("database is locked");
  });
});

describe("bun run dashboard", () => {
  test("serves on 127.0.0.1 at USAGE_INSIGHTS_PORT", async () => {
    seed();
    const port = 46_000 + Math.floor(Math.random() * 1000);
    const proc = Bun.spawn(["bun", "run", "dashboard"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, USAGE_INSIGHTS_DATA_DIR: dataDir, USAGE_INSIGHTS_PORT: String(port) },
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      let status = 0;
      for (let i = 0; i < 50 && !status; i++) {
        status = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.status, () => 0);
        if (!status) await Bun.sleep(100);
      }
      expect(status).toBe(200);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
});

describe("JSON", () => {
  test("serves the same view models as JSON", async () => {
    seed();
    const overview = await get("/api/overview");
    expect(overview.status).toBe(200);
    expect(overview.type).toContain("application/json");
    expect(JSON.parse(overview.body).providers.map((p: { provider: string }) => p.provider)).toEqual(["codex"]);

    const history = await get("/api/provider/codex");
    expect(JSON.parse(history.body).cycles).toHaveLength(1);
    expect((await get("/api/provider/nobody")).status).toBe(404);

    const health = await get("/api/health");
    expect(JSON.parse(health.body).unclassified).toHaveLength(1);
  });
});
