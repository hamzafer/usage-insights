import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDashboardData } from "../src/dashboard/data.ts";
import { buildProjectsRange } from "../src/dashboard/projects-range.ts";
import { dashboardHandler } from "../src/dashboard/server.ts";
import { openStore } from "../src/store.ts";
import { NOW, tokenEvent } from "./dashboard-fixtures.ts";

// `GET /api/projects?range=` over a real store in a temp data directory (ticket #18).
let dataDir: string;
let dbPath: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "usage-insights-projects-range-"));
  dbPath = join(dataDir, "usage.db");
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

// NOW is 2026-10-05T12:00Z: 2 days ago is inside 7d, 20 days ago only inside 30d, 40 days ago in neither.
function seed() {
  const store = openStore(dbPath);
  store.saveTokenEvents([
    { key: "a", ...tokenEvent("claude", "2026-10-03T10:00:00.000Z", "/fake/home/alpha", "claude-opus-5-5", 600) },
    { key: "b", ...tokenEvent("claude", "2026-10-04T10:00:00.000Z", "/fake/home/beta", "claude-sonnet-5", 200) },
    { key: "c", ...tokenEvent("claude", "2026-10-04T11:00:00.000Z", null, "claude-opus-5-5", 200) },
    { key: "d", ...tokenEvent("claude", "2026-09-15T10:00:00.000Z", "/fake/home/beta", "claude-sonnet-5", 1000) },
    { key: "e", ...tokenEvent("codex", "2026-08-20T10:00:00.000Z", "/fake/home/gamma", "gpt-6-astra", 500) },
  ]);
  store.close();
}

async function get(path: string) {
  const handler = dashboardHandler({ load: () => loadDashboardData(dbPath), now: () => new Date(NOW), timeZone: "UTC" });
  const res = await handler(new Request(`http://127.0.0.1:6740${path}`));
  return { status: res.status, body: await res.text() };
}

describe("GET /api/projects?range=", () => {
  test("7d ranks Projects and models per Provider by folder name, with friendly model names", async () => {
    seed();
    const res = await get("/api/projects?range=7d");
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ range: "7d", from: "2026-09-28T12:00:00.000Z", to: NOW });
    const claude = body.providers.find((p: { provider: string }) => p.provider === "claude");
    expect(claude.total).toBe(1000);
    expect(claude.projects).toEqual([
      { name: "alpha", label: "alpha", tokens: 600, share: 0.6 },
      { name: "(other)", label: "(other)", tokens: 200, share: 0.2 },
      { name: "beta", label: "beta", tokens: 200, share: 0.2 },
    ]);
    expect(claude.models).toEqual([
      { name: "claude-opus-5-5", label: "Opus 5.5", tokens: 800, share: 0.8 },
      { name: "claude-sonnet-5", label: "Sonnet 5", tokens: 200, share: 0.2 },
    ]);
    expect(res.body).not.toContain("/fake/home");
  });

  test("30d reaches further back; a Provider with logs but none in the range keeps an empty tab", async () => {
    seed();
    const body = JSON.parse((await get("/api/projects?range=30d")).body);
    expect(body.providers.map((p: { provider: string }) => p.provider)).toEqual(["claude", "codex"]);
    const [claude, codex] = body.providers;
    expect(claude.total).toBe(2000);
    expect(claude.projects[0]).toEqual({ name: "beta", label: "beta", tokens: 1200, share: 0.6 });
    expect(codex).toEqual({ provider: "codex", total: 0, projects: [], models: [] });
  });

  test("without token logs there are no Providers", async () => {
    const body = JSON.parse((await get("/api/projects?range=7d")).body);
    expect(body.providers).toEqual([]);
  });

  test("an unknown range is a 400; no range keeps the per-Cycle shape", async () => {
    seed();
    const bad = await get("/api/projects?range=1y");
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body).error).toContain("7d or 30d");
    const legacy = JSON.parse((await get("/api/projects")).body);
    expect(legacy.providers[0].cycles).toBeArray();
  });
});

describe("buildProjectsRange", () => {
  test("the range end is exclusive and its start inclusive", () => {
    const tokens = [
      tokenEvent("codex", "2026-09-28T12:00:00.000Z", null, "gpt-6-astra", 10),
      tokenEvent("codex", NOW, null, "gpt-6-astra", 99),
    ];
    const page = buildProjectsRange({ readings: [], latest: [], gaps: [], tokens }, NOW, "7d");
    expect(page.providers[0]!.total).toBe(10);
  });
});
