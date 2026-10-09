import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDashboardData } from "../src/dashboard/data.ts";
import type { CycleHistory } from "../src/dashboard/history.ts";
import { dashboardHandler } from "../src/dashboard/server.ts";
import type { DashboardData } from "../src/dashboard/view-model.ts";
import { openStore } from "../src/store.ts";
import type { TokenEvent } from "../src/store.ts";
import type { Reading } from "../src/window-model.ts";
import { NOW, reading, stored, syntheticReadings, tokenEvent } from "./dashboard-fixtures.ts";

// `GET /api/history/:provider` over a real store in a temp data directory (synthetic data only).
let dataDir: string;
let dbPath: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "usage-insights-history-"));
  dbPath = join(dataDir, "usage.db");
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

function seed() {
  const store = openStore(dbPath);
  store.saveReadings(syntheticReadings().filter((r) => r.source === "openusage").map((r) => stored(r)));
  store.close();
}

async function get(path: string, load: () => DashboardData = () => loadDashboardData(dbPath)) {
  const handler = dashboardHandler({ load, now: () => new Date(NOW), timeZone: "UTC" });
  const res = await handler(new Request(`http://127.0.0.1:6740${path}`));
  return { status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text() };
}

describe("GET /api/history/:provider", () => {
  test("lists ended and running Cycles with used and wasted share, basis and Limit Hits", async () => {
    seed();
    const res = await get("/api/history/codex");
    expect(res.status).toBe(200);
    expect(res.type).toContain("application/json");
    const history = JSON.parse(res.body) as CycleHistory;
    expect(history.provider).toBe("codex");
    expect(history.cycles).toEqual([
      {
        label: "Weekly",
        from: null,
        resetAt: "2026-10-01T00:00:00.000Z",
        running: false,
        usedShare: 0.7,
        wasteShare: 0.3,
        basis: "measured",
        lowConfidence: false,
        inferred: false,
        limitHits: [],
      },
      {
        label: "Weekly",
        from: "2026-10-01T00:00:00.000Z",
        resetAt: "2026-10-08T00:00:00.000Z",
        running: true,
        usedShare: 0.4,
        wasteShare: null,
        basis: "measured",
        lowConfidence: false,
        inferred: false,
        // The Session that hit its limit inside this Cycle; blocked until Overage grew an hour later.
        limitHits: [
          {
            role: "session",
            label: "Session",
            hitAt: "2026-10-03T06:00:00.000Z",
            blockedMs: 3_600_000,
            blockedUntil: "2026-10-03T07:00:00.000Z",
            endedBy: "overage",
          },
        ],
      },
    ]);
  });

  test("a Cycle that reached its limit carries its own Limit Hit, blocked until the Reset", async () => {
    const store = openStore(dbPath);
    store.saveReadings(
      [
        reading("codex", "Weekly", "cycle", 50, "2026-10-01T00:00:00.000Z", "2026-09-28T00:00:00.000Z"),
        reading("codex", "Weekly", "cycle", 100, "2026-10-01T00:00:00.000Z", "2026-09-29T12:00:00.000Z"),
        reading("codex", "Weekly", "cycle", 100, "2026-10-01T00:00:00.000Z", "2026-09-30T23:55:00.000Z"),
      ].map((r) => stored(r)),
    );
    store.close();
    const [cycle] = (JSON.parse((await get("/api/history/codex")).body) as CycleHistory).cycles;
    expect(cycle).toMatchObject({ usedShare: 1, wasteShare: 0 });
    expect(cycle!.limitHits).toEqual([
      {
        role: "cycle",
        label: "Weekly",
        hitAt: "2026-09-29T12:00:00.000Z",
        blockedMs: 36 * 3_600_000,
        blockedUntil: "2026-10-01T00:00:00.000Z",
        endedBy: "reset",
      },
    ]);
  });

  test("Backfill Waste keeps its basis and confidence: Estimated and low confidence for Claude", async () => {
    const data = { readings: syntheticReadings().filter((r) => r.provider === "claude"), latest: [], gaps: [] };
    const history = JSON.parse((await get("/api/history/claude", () => data)).body) as CycleHistory;
    expect(history.cycles).toHaveLength(1);
    expect(history.cycles[0]).toMatchObject({ usedShare: 0.55, wasteShare: 0.45, basis: "estimated", lowConfidence: true });
  });

  test("past Claude Cycles without readings are Estimated from tokens, never mixed with Measured ones", async () => {
    // A running Cycle with 12 live Snapshots, 1 000 tokens per 2 points: calibration ready (500 per 1%).
    const readings: Reading[] = [];
    const tokens: TokenEvent[] = [];
    for (let h = 0; h <= 11; h++) {
      const at = `2026-10-05T${String(h).padStart(2, "0")}:00:00.000Z`;
      readings.push(reading("claude", "Weekly", "cycle", 2 * h, "2026-10-08T00:00:00.000Z", at));
      if (h > 0) tokens.push(tokenEvent("claude", `2026-10-05T${String(h - 1).padStart(2, "0")}:30:00.000Z`, null, "m", 1_000));
    }
    // The Cycle before, tokens only: 20 000 tokens = 40% used, 60% Waste.
    tokens.push(tokenEvent("claude", "2026-09-28T12:00:00.000Z", null, "m", 20_000));
    const data = { readings, latest: [], gaps: [], tokens };

    const { cycles } = JSON.parse((await get("/api/history/claude", () => data)).body) as CycleHistory;
    expect(cycles.map((c) => [c.running, c.basis, c.usedShare, c.wasteShare])).toEqual([
      [false, "estimated", 0.4, 0.6],
      [true, "measured", 0.22, null],
    ]);
    expect(cycles[0]).toMatchObject({ from: "2026-09-24T00:00:00.000Z", resetAt: "2026-10-01T00:00:00.000Z", inferred: true });
  });

  test("an unknown Provider, or one that is not valid percent-encoding, is a JSON 404", async () => {
    seed();
    const res = await get("/api/history/nobody");
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error).toBe("No Cycles recorded for this Provider");
    expect((await get("/api/history/%")).status).toBe(404);
  });
});
