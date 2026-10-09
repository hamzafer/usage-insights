import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDashboardData } from "../src/dashboard/data.ts";
import { dashboardHandler } from "../src/dashboard/server.ts";
import { buildTokensDaily } from "../src/dashboard/tokens-daily.ts";
import { openStore } from "../src/store.ts";
import { NOW, tokenEvent } from "./dashboard-fixtures.ts";

// `GET /api/tokens/daily` over a real store in a temp data directory, plus the pure builder.
let dataDir: string;
let dbPath: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "usage-insights-tokens-"));
  dbPath = join(dataDir, "usage.db");
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

function seed() {
  const store = openStore(dbPath);
  store.saveTokenEvents([
    { key: "a", ...tokenEvent("claude", "2026-10-05T10:00:00.000Z", "/private/place/alpha", "claude-opus-5-5", 400) },
    { key: "b", ...tokenEvent("claude", "2026-10-05T11:00:00.000Z", null, "claude-opus-5-5", 200) },
    { key: "c", ...tokenEvent("codex", "2026-10-03T09:00:00.000Z", null, "gpt-6-astra", 1_000) },
    { key: "d", ...tokenEvent("claude-work", "2026-10-03T09:30:00.000Z", null, "claude-opus-5-5", 100) },
    // 20 days ago: only in the 30-day range, yet it ranks the models for colors.
    { key: "e", ...tokenEvent("codex", "2026-09-15T09:00:00.000Z", null, "gpt-5.5", 9_000) },
  ]);
  store.close();
}

async function get(path: string) {
  const handler = dashboardHandler({ load: (needs) => loadDashboardData(dbPath, needs), now: () => new Date(NOW), timeZone: "UTC" });
  const res = await handler(new Request(`http://127.0.0.1:6740${path}`));
  return { status: res.status, body: (await res.json()) as any };
}

describe("GET /api/tokens/daily", () => {
  test("7d lists every local day, zero days included, tokens per Provider per model", async () => {
    seed();
    const { status, body } = await get("/api/tokens/daily?range=7d");
    expect(status).toBe(200);
    expect(body.range).toBe("7d");
    expect(body.days.map((d: { date: string }) => d.date)).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
    expect(body.days[4].byProvider).toEqual({ codex: { "gpt-6-astra": 1_000 }, "claude-work": { "claude-opus-5-5": 100 } });
    expect(body.days[5].byProvider).toEqual({});
    expect(body.days[6].byProvider).toEqual({ claude: { "claude-opus-5-5": 600 } });
    expect(JSON.stringify(body)).not.toContain("/private/place");
  });

  test("models rank by the 30-day totals in every range, with friendly names", async () => {
    seed();
    const { body } = await get("/api/tokens/daily?range=7d");
    expect(body.models).toEqual([
      { id: "gpt-5.5", name: "GPT-5.5" },
      { id: "gpt-6-astra", name: "GPT-6 Astra" },
      { id: "claude-opus-5-5", name: "Opus 5.5" },
    ]);
    expect(body.providers).toEqual(["claude", "claude-work", "codex"]);
  });

  test("30d has 30 days and includes older events", async () => {
    seed();
    const { body } = await get("/api/tokens/daily?range=30d");
    expect(body.days).toHaveLength(30);
    expect(body.days[0].date).toBe("2026-09-06");
    expect(body.days.find((d: { date: string }) => d.date === "2026-09-15").byProvider).toEqual({ codex: { "gpt-5.5": 9_000 } });
  });

  test("defaults to 7d; an unknown range is a 400", async () => {
    seed();
    expect((await get("/api/tokens/daily")).body.days).toHaveLength(7);
    const bad = await get("/api/tokens/daily?range=90d");
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain("7d or 30d");
  });

  test("an empty data directory answers empty models and zero days", async () => {
    const { status, body } = await get("/api/tokens/daily?range=7d");
    expect(status).toBe(200);
    expect(body.models).toEqual([]);
    expect(body.days).toHaveLength(7);
  });
});

describe("buildTokensDaily", () => {
  test("days follow the time zone's calendar", () => {
    const events = [tokenEvent("codex", "2026-10-04T23:30:00.000Z", null, "gpt-6-astra", 8)];
    const utc = buildTokensDaily(events, "7d", NOW, "UTC");
    const berlin = buildTokensDaily(events, "7d", NOW, "Europe/Berlin");
    expect(utc.days.find((d) => d.date === "2026-10-04")!.byProvider).toEqual({ codex: { "gpt-6-astra": 8 } });
    expect(berlin.days.find((d) => d.date === "2026-10-05")!.byProvider).toEqual({ codex: { "gpt-6-astra": 8 } });
  });

  test("a DST change does not skip or repeat a day", () => {
    const { days } = buildTokensDaily([], "30d", "2026-11-03T12:00:00.000Z", "America/New_York");
    const dates = days.map((d) => d.date);
    expect(new Set(dates).size).toBe(30);
    expect(dates.at(-1)).toBe("2026-11-03");
    expect(dates).toContain("2026-11-01");
  });
});
