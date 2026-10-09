import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDashboardData } from "../src/dashboard/data.ts";
import { dashboardHandler } from "../src/dashboard/server.ts";
import type { DataNeeds } from "../src/dashboard/view-model.ts";
import { openStore } from "../src/store.ts";
import { NOW, reading, stored, SYNTHETIC_GAPS, syntheticReadings, tokenEvent } from "./dashboard-fixtures.ts";

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

describe("API", () => {
  test("overview has each Provider's last Cycle Waste, Limit Hits and Overage", async () => {
    seed();
    const res = await get("/api/overview");
    expect(res.status).toBe(200);
    const [codex] = JSON.parse(res.body).providers;
    expect(codex.provider).toBe("codex");
    expect(codex.lastCycles[0].waste.share).toBeCloseTo(0.3);
    expect(codex.limitHits.count).toBeGreaterThan(0);
    expect(codex.overage.length).toBeGreaterThan(0);
  });

  test("overview of an empty data directory has no Providers", async () => {
    const res = await get("/api/overview");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).providers).toEqual([]);
  });

  test("Provider history has Cycles, Sessions, Idle Capacity and gaps; unknown is a 404", async () => {
    seed();
    const history = JSON.parse((await get("/api/provider/codex")).body);
    expect(history.cycles).toHaveLength(1);
    expect(history.sessions.length).toBeGreaterThan(0);
    expect(history.idle.length).toBeGreaterThan(0);
    expect(history.gaps.length).toBeGreaterThan(0);
    expect((await get("/api/provider/nobody")).status).toBe(404);
  });

  test("data health has Claude calibration: calibrating, with samples", async () => {
    seed();
    const store = openStore(dbPath);
    store.saveReadings([
      stored(reading("claude", "Weekly", "cycle", 10, "2026-10-12T00:00:00.000Z", "2026-10-05T10:00:00.000Z")),
      stored(reading("claude", "Weekly", "cycle", 12, "2026-10-12T00:00:00.000Z", "2026-10-05T11:00:00.000Z")),
    ]);
    store.saveTokenEvents([{ key: "c", ...tokenEvent("claude", "2026-10-05T10:30:00.000Z", null, "claude-opus-5", 5_000) }]);
    store.close();

    const api = JSON.parse((await get("/api/health")).body);
    expect(api.calibration.find((c: { role: string }) => c.role === "cycle")).toMatchObject({ provider: "claude", samples: 1, ready: false });
  });

  test("Projects and models are by folder name, never full paths", async () => {
    seed();
    const store = openStore(dbPath);
    store.saveTokenEvents([
      { key: "a", ...tokenEvent("codex", "2026-10-03T10:00:00.000Z", "/private/place/alpha", "gpt-5.5", 300) },
      { key: "b", ...tokenEvent("codex", "2026-10-03T11:00:00.000Z", null, "gpt-6-astra", 100) },
    ]);
    store.close();

    const api = await get("/api/projects");
    expect(api.type).toContain("application/json");
    expect(JSON.parse(api.body).providers[0].cycles[0].byProject[0]).toEqual({ name: "alpha", tokens: 300, share: 0.75 });
    expect(api.body).not.toContain("/private/place");
  });

  test("data health lists unclassified lines, recorder gaps, last Snapshots and failed runs", async () => {
    seed();
    const store = openStore(dbPath);
    store.saveRun({ job: "backfill:codex", at: "2026-10-05T09:00:00.000Z", ok: false, reason: "sessions dir unreadable" });
    store.saveRun({ job: "backfill:tokens", at: "2026-10-05T09:00:00.000Z", ok: true, reason: null });
    store.saveRun({ job: "report", at: "2026-10-05T10:00:00.000Z", ok: false, reason: "Telegram send failed (HTTP 401)" });
    store.close();

    const api = JSON.parse((await get("/api/health")).body);
    expect(api.unclassified).toEqual([expect.objectContaining({ provider: "cursor", label: "Mystery meter" })]);
    expect(api.recorderGaps.some((g: { reason: string }) => g.reason.includes("OpenUsage unreachable"))).toBe(true);
    expect(api.providers.find((p: { provider: string }) => p.provider === "codex").lastSnapshotAt).not.toBeNull();
    expect(api.failedRuns.map((r: { job: string }) => r.job)).toEqual(["report", "backfill:codex"]);
  });

  test("a Provider path that is not valid percent-encoding is a 404, not a crash", async () => {
    seed();
    expect((await get("/api/provider/%")).status).toBe(404);
    expect((await get("/api/hero/%E0%A4%A")).status).toBe(404);
  });

  test("requests for another host name or port are refused (DNS rebinding)", async () => {
    seed();
    const guarded = dashboardHandler({ load: () => loadDashboardData(dbPath), now: () => new Date(NOW), timeZone: "UTC", port: 6740 });
    const status = async (host: string) =>
      (await guarded(new Request("http://127.0.0.1:6740/api/overview", { headers: { host } }))).status;
    expect(await status("127.0.0.1:6740")).toBe(200);
    expect(await status("localhost:6740")).toBe(200);
    expect(await status("evil.example:6740")).toBe(403);
    expect(await status("127.0.0.1:6741")).toBe(403);
    expect(await status("localhost")).toBe(403);
  });

  test("unknown API paths are 404 and other methods are 405", async () => {
    expect((await get("/api/nope")).status).toBe(404);
    expect((await get("/api/overview", "POST")).status).toBe(405);
  });

  test("a failing data load is a loud 500, not an empty response", async () => {
    const failing = dashboardHandler({
      load: () => {
        throw new Error("database is locked");
      },
      now: () => new Date(NOW),
      log: () => {},
    });
    const res = await failing(new Request("http://127.0.0.1/api/overview"));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("database is locked");
  });

  test("each endpoint asks only for the token rows it needs", async () => {
    const asked: Record<string, DataNeeds | undefined> = {};
    let path = "";
    const spy = dashboardHandler({
      load: (needs) => {
        asked[path] = needs;
        return loadDashboardData(dbPath, needs);
      },
      now: () => new Date(NOW),
      timeZone: "UTC",
    });
    seed();
    for (path of ["/api/overview", "/api/hero/codex", "/api/provider/codex", "/api/health", "/api/last-week", "/api/projects?range=7d", "/api/tokens/daily?range=7d", "/api/sessions/top?range=7d"]) {
      await spy(new Request(`http://127.0.0.1${path}`));
    }
    // Overview, hero and Provider history never touch token rows.
    expect(asked["/api/overview"]).toEqual({ tokens: "none" });
    expect(asked["/api/hero/codex"]).toEqual({ tokens: "none" });
    expect(asked["/api/provider/codex"]).toEqual({ tokens: "none" });
    // Health and the Last week line need the Claude calibration, which uses every token row.
    expect(asked["/api/health"]).toEqual({ tokens: "all" });
    expect(asked["/api/last-week"]).toEqual({ tokens: "all" });
    // Ranges read only their own days (plus slack for time zones).
    expect(asked["/api/projects?range=7d"]).toEqual({ tokens: { from: "2026-09-28T12:00:00.000Z" } });
    expect(asked["/api/tokens/daily?range=7d"]).toEqual({ tokens: { from: "2026-09-02T12:00:00.000Z" } });
    // Only top sessions loads session rows, and they serve as the token rows too (one query).
    expect(asked["/api/sessions/top?range=7d"]).toEqual({ tokens: "all", sessionTokens: true });
  });

  test("the data load reads token rows only as asked", () => {
    const store = openStore(dbPath);
    store.saveTokenEvents([
      { ...tokenEvent("codex", "2026-09-01T10:00:00.000Z", "/repos/alpha", "gpt-5-codex", 100), key: "k1", session: "s1" },
      { ...tokenEvent("codex", "2026-10-04T10:00:00.000Z", "/repos/alpha", "gpt-5-codex", 200), key: "k2", session: "s2" },
    ]);
    store.close();
    expect(loadDashboardData(dbPath, { tokens: "none" }).tokens).toEqual([]);
    expect(loadDashboardData(dbPath, { tokens: { from: "2026-10-01T00:00:00.000Z" } }).tokens!.map((e) => e.at)).toEqual([
      "2026-10-04T10:00:00.000Z",
    ]);
    expect(loadDashboardData(dbPath, { tokens: "all" }).tokens).toHaveLength(2);
    const sessions = loadDashboardData(dbPath, { tokens: "all", sessionTokens: true });
    expect(sessions.sessionTokens!.map((e) => e.session)).toEqual(["s1", "s2"]);
    expect(sessions.tokens).toBe(sessions.sessionTokens!);
  });

  test("Last week: the Report's week numbers for the Overview line", async () => {
    seed();
    const res = await get("/api/last-week");
    expect(res.status).toBe(200);
    const week = JSON.parse(res.body);
    expect(week.to).toBe(NOW);
    expect(week).toHaveProperty("cycles");
    expect(week.limitHits.count).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(week.overage)).toBe(true);
  });

  test("without a built export, pages say how to build the app (never old HTML)", async () => {
    for (const path of ["/", "/legacy", "/health", "/projects", "/provider/codex"]) {
      const res = await get(path);
      expect(res.status).toBe(503);
      expect(res.type).toContain("text/plain");
      expect(res.body).toContain("bun run web:build");
    }
  });
});

describe("bun run dashboard", () => {
  test("serves on 127.0.0.1 at USAGE_INSIGHTS_PORT", async () => {
    seed();
    const port = 46_000 + Math.floor(Math.random() * 1000);
    const proc = Bun.spawn(["bun", "run", "dashboard", "--no-build"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, USAGE_INSIGHTS_DATA_DIR: dataDir, USAGE_INSIGHTS_PORT: String(port) },
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      let status = 0;
      for (let i = 0; i < 50 && !status; i++) {
        status = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.status, () => 0);
        if (!status) await Bun.sleep(100);
      }
      expect(status).toBe(200);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
});
