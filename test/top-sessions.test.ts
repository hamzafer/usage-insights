import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Calibration } from "../src/calibration.ts";
import { loadDashboardData } from "../src/dashboard/data.ts";
import { dashboardHandler } from "../src/dashboard/server.ts";
import { openStore, type KeyedTokenEvent, type SessionTokenEvent, type StoredReading } from "../src/store.ts";
import { topSessions } from "../src/top-sessions.ts";
import type { Reading } from "../src/window-model.ts";

// Top sessions (ticket #21). Synthetic sessions only: every value is made up.

const NOW = "2026-10-08T12:00:00.000Z";

function call(
  provider: string,
  session: string | null,
  at: string,
  tokens: number,
  extra: { project?: string | null; model?: string } = {},
): SessionTokenEvent {
  return {
    provider,
    session,
    at,
    project: extra.project === undefined ? "/code/alpha" : extra.project,
    model: extra.model ?? "model-a",
    input: tokens,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
  };
}

/** A Codex rate-limit reading from its logs (the Codex Backfill), at a token_count line's time. */
function codexReading(label: "Session" | "Weekly", used: number, resetsAt: string, fetchedAt: string): Reading {
  return { provider: "codex", label, role: label === "Session" ? "session" : "cycle", used, limit: 100, resetsAt, fetchedAt, source: "backfill:codex" };
}

const H5 = "2026-10-08T14:00:00.000Z";
const WEEK = "2026-10-12T00:00:00.000Z";

describe("topSessions", () => {
  test("ranks sessions by tokens in the range, with project name, main model and span", () => {
    const events = [
      call("claude", "s-small", "2026-10-07T09:00:00.000Z", 100),
      call("claude", "s-big", "2026-10-07T10:00:00.000Z", 300, { model: "model-a" }),
      call("claude", "s-big", "2026-10-07T11:00:00.000Z", 500, { model: "model-b", project: "/code/beta" }),
      call("claude", "s-old", "2026-09-20T10:00:00.000Z", 9999), // before the 7-day range
      call("claude", null, "2026-10-07T10:00:00.000Z", 9999), // no session: not listed
    ];
    const rows = topSessions({ events, readings: [], calibrations: [], now: NOW, range: "7d" });
    expect(rows.map((r) => [r.provider, r.project, r.model, r.tokens, r.startedAt, r.endedAt, r.calls])).toEqual([
      ["claude", "beta", "model-b", 800, "2026-10-07T10:00:00.000Z", "2026-10-07T11:00:00.000Z", 2],
      ["claude", "alpha", "model-a", 100, "2026-10-07T09:00:00.000Z", "2026-10-07T09:00:00.000Z", 1],
    ]);
    expect(topSessions({ events, readings: [], calibrations: [], now: NOW, range: "30d" })[0]!.tokens).toBe(9999);
    expect(topSessions({ events, readings: [], calibrations: [], now: NOW, range: "7d", limit: 1 })).toHaveLength(1);
  });

  test("a session without a project shows as (other)", () => {
    const rows = topSessions({ events: [call("codex", "c1", "2026-10-08T10:00:00.000Z", 5, { project: null })], readings: [], calibrations: [], now: NOW, range: "7d" });
    expect(rows[0]!.project).toBe("(other)");
  });

  test("Codex: the limits' movement during the session, from its own log readings (Measured)", () => {
    const events = [
      call("codex", "c1", "2026-10-08T10:00:00.000Z", 10),
      call("codex", "c1", "2026-10-08T10:30:00.000Z", 10),
      call("codex", "c1", "2026-10-08T11:00:00.000Z", 10),
    ];
    const readings = [
      // The account before the session started: the baseline.
      codexReading("Session", 20, H5, "2026-10-08T09:30:00.000Z"),
      codexReading("Weekly", 40, WEEK, "2026-10-08T09:30:00.000Z"),
      codexReading("Session", 25, H5, "2026-10-08T10:00:00.000Z"),
      codexReading("Weekly", 41, WEEK, "2026-10-08T10:00:00.000Z"),
      codexReading("Session", 35, H5, "2026-10-08T10:30:00.000Z"),
      codexReading("Weekly", 42, WEEK, "2026-10-08T10:30:00.000Z"),
      codexReading("Session", 50, H5, "2026-10-08T11:00:00.000Z"),
      codexReading("Weekly", 44, WEEK, "2026-10-08T11:00:00.000Z"),
    ];
    const [row] = topSessions({ events, readings, calibrations: [], now: NOW, range: "7d" });
    expect(row!.basis).toBe("measured");
    expect(row!.sessionShare).toBeCloseTo(0.3);
    expect(row!.weeklyShare).toBeCloseTo(0.04);
  });

  test("Codex: a 5-hour Reset during the session counts the new window from zero", () => {
    const events = [call("codex", "c1", "2026-10-08T08:50:00.000Z", 10), call("codex", "c1", "2026-10-08T09:10:00.000Z", 10)];
    const readings = [
      codexReading("Session", 90, "2026-10-08T09:00:00.000Z", "2026-10-08T08:50:00.000Z"),
      codexReading("Session", 6, H5, "2026-10-08T09:10:00.000Z"),
    ];
    const [row] = topSessions({ events, readings, calibrations: [], now: NOW, range: "7d" });
    // No earlier reading of the account: the session's first reading is the baseline (90 is not
    // counted, other sessions may have used it); the new window then counts from 0.
    expect(row!.sessionShare).toBeCloseTo(0.06);
    expect(row!.weeklyShare).toBeNull(); // no weekly readings: unknown
  });

  test("Codex without matching log readings: limits unknown", () => {
    const [row] = topSessions({ events: [call("codex", "c1", "2026-10-08T10:00:00.000Z", 10)], readings: [], calibrations: [], now: NOW, range: "7d" });
    expect([row!.sessionShare, row!.weeklyShare, row!.basis]).toEqual([null, null, null]);
  });

  test("Claude: tokens only while calibrating, then ~ estimates from its account's calibration", () => {
    const events = [call("claude-work", "w1", "2026-10-08T10:00:00.000Z", 5000)];
    const calibrating = topSessions({ events, readings: [], calibrations: [], now: NOW, range: "7d" });
    expect([calibrating[0]!.sessionShare, calibrating[0]!.weeklyShare, calibrating[0]!.basis]).toEqual([null, null, null]);

    const ready = (role: "session" | "cycle", tokensPerPercent: number): Calibration => ({
      provider: "claude-work",
      label: role === "session" ? "Session" : "Weekly",
      role,
      samples: 20,
      movement: 50,
      tokens: 1,
      ready: true,
      tokensPerPercent,
    });
    const [row] = topSessions({ events, readings: [], calibrations: [ready("session", 100), ready("cycle", 1000)], now: NOW, range: "7d" });
    expect(row!.basis).toBe("estimated");
    expect(row!.sessionShare).toBeCloseTo(0.5);
    expect(row!.weeklyShare).toBeCloseTo(0.05);
  });
});

describe("GET /api/sessions/top", () => {
  let dataDir: string;
  let dbPath: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "usage-insights-top-sessions-"));
    dbPath = join(dataDir, "usage.db");
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  const keyed = (e: SessionTokenEvent, key: string): KeyedTokenEvent => ({ ...e, key });
  const storedReading = (r: Reading): StoredReading => ({
    provider: r.provider,
    label: r.label,
    role: r.role,
    used: r.used,
    limit: r.limit,
    unit: "percent",
    resetsAt: r.resetsAt,
    periodMs: null,
    plan: null,
    fetchedAt: r.fetchedAt,
    recordedAt: r.fetchedAt,
    source: r.source,
  });

  function seed() {
    const store = openStore(dbPath);
    store.saveTokenEvents([
      keyed(call("codex", "c1", "2026-10-08T10:00:00.000Z", 400, { model: "gpt-x" }), "k1"),
      keyed(call("codex", "c1", "2026-10-08T11:00:00.000Z", 400, { model: "gpt-x" }), "k2"),
      keyed(call("claude", "s1", "2026-10-02T10:00:00.000Z", 300, { model: "claude-opus-5-5" }), "k3"),
      keyed(call("claude", "s2", "2026-09-20T10:00:00.000Z", 900), "k4"),
    ]);
    store.saveReadings(
      [
        codexReading("Session", 10, H5, "2026-10-08T10:00:00.000Z"),
        codexReading("Session", 22, H5, "2026-10-08T11:00:00.000Z"),
        codexReading("Weekly", 30, WEEK, "2026-10-08T10:00:00.000Z"),
        codexReading("Weekly", 33, WEEK, "2026-10-08T11:00:00.000Z"),
      ].map(storedReading),
    );
    store.close();
  }

  async function get(path: string) {
    const handler = dashboardHandler({ load: (needs) => loadDashboardData(dbPath, needs), now: () => new Date(NOW), timeZone: "UTC" });
    const res = await handler(new Request(`http://127.0.0.1:6740${path}`));
    return { status: res.status, body: (await res.json()) as any };
  }

  test("lists the range's biggest sessions with limits Measured for Codex and tokens only for Claude", async () => {
    seed();
    const { status, body } = await get("/api/sessions/top?range=7d");
    expect(status).toBe(200);
    expect(body.range).toBe("7d");
    expect(body.sessions).toHaveLength(2);
    const [codex, claude] = body.sessions;
    expect(codex).toMatchObject({ provider: "codex", project: "alpha", model: "gpt-x", tokens: 800, basis: "measured" });
    expect(codex.sessionShare).toBeCloseTo(0.12);
    expect(codex.weeklyShare).toBeCloseTo(0.03);
    expect(claude).toMatchObject({ provider: "claude", tokens: 300, sessionShare: null, weeklyShare: null, basis: null });
    // The display name, as Tokens by model shows it (the id goes in the tooltip).
    expect(claude).toMatchObject({ model: "claude-opus-5-5", modelName: "Opus 5.5" });
    // Never the full path of a Project.
    expect(JSON.stringify(body)).not.toContain("/code/");
  });

  test("30d reaches further back; limit caps the rows", async () => {
    seed();
    expect((await get("/api/sessions/top?range=30d")).body.sessions).toHaveLength(3);
    expect((await get("/api/sessions/top?range=30d&limit=1")).body.sessions.map((s: any) => s.tokens)).toEqual([900]);
  });

  test("provider keeps one Provider's sessions; providers lists every Provider in the range", async () => {
    seed();
    const all = (await get("/api/sessions/top?range=30d")).body;
    expect(all.provider).toBeNull();
    expect(all.providers).toEqual(["claude", "codex"]);
    const codex = (await get("/api/sessions/top?range=30d&provider=codex")).body;
    expect(codex.provider).toBe("codex");
    expect(codex.sessions.map((s: any) => s.provider)).toEqual(["codex"]);
    // The limit applies within the Provider: Claude's bigger sessions never crowd Codex out.
    expect((await get("/api/sessions/top?range=30d&limit=1&provider=codex")).body.sessions.map((s: any) => s.tokens)).toEqual([800]);
    expect((await get("/api/sessions/top?range=7d&provider=claude")).body.providers).toEqual(["claude", "codex"]);
    expect((await get("/api/sessions/top?range=7d&provider=nobody")).body.sessions).toEqual([]);
    expect((await get("/api/sessions/top?provider=%2Fetc")).status).toBe(400);
  });

  test("defaults to 7d; a bad range or limit is a 400", async () => {
    seed();
    expect((await get("/api/sessions/top")).body.range).toBe("7d");
    expect((await get("/api/sessions/top?range=1y")).status).toBe(400);
    expect((await get("/api/sessions/top?limit=0")).status).toBe(400);
  });

  test("an empty data directory lists no sessions", async () => {
    const { status, body } = await get("/api/sessions/top?range=7d");
    expect(status).toBe(200);
    expect(body.sessions).toEqual([]);
  });
});
