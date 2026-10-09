import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDashboardData } from "../src/dashboard/data.ts";
import type { HeroCycle } from "../src/dashboard/hero.ts";
import { dashboardHandler } from "../src/dashboard/server.ts";
import { openStore } from "../src/store.ts";
import { NOW, reading, stored, syntheticReadings } from "./dashboard-fixtures.ts";

// `GET /api/hero/:provider` over a real store in a temp data directory.
let dataDir: string;
let dbPath: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "usage-insights-hero-"));
  dbPath = join(dataDir, "usage.db");
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

function seed(extra: ReturnType<typeof reading>[] = []) {
  const store = openStore(dbPath);
  store.saveReadings(
    [...syntheticReadings(), ...extra].map((r) => ({ ...stored(r), source: r.source })),
  );
  store.close();
}

async function get(path: string) {
  const handler = dashboardHandler({ load: () => loadDashboardData(dbPath), now: () => new Date(NOW) });
  const res = await handler(new Request(`http://127.0.0.1:6740${path}`));
  return { status: res.status, body: (await res.json()) as HeroCycle & { error?: string } };
}

const HOUR = 3_600_000;

describe("GET /api/hero/:provider", () => {
  test("the running Cycle: readings, start, Reset, limit and Pace to the Reset", async () => {
    seed();
    const { status, body } = await get("/api/hero/codex");
    expect(status).toBe(200);
    expect(body.label).toBe("Weekly");
    expect(body.labels).toEqual(["Weekly"]);
    expect(body.running).toBe(true);
    expect(body.start).toBe("2026-10-01T00:00:00.000Z"); // the previous Cycle's Reset
    expect(body.resetsAt).toBe("2026-10-08T00:00:00.000Z");
    expect(body.endedAt).toBeNull();
    expect(body.limitShare).toBe(1);
    expect(body.readings).toEqual([
      { at: "2026-10-01T01:00:00.000Z", usedShare: 0.1, basis: "measured" },
      { at: "2026-10-05T11:55:00.000Z", usedShare: 0.4, basis: "measured" },
    ]);

    // Pace is anchored at the Cycle's start (as src/pace.ts): 40% in the time since, kept up to the Reset.
    const elapsed = Date.parse("2026-10-05T11:55:00.000Z") - Date.parse("2026-10-01T00:00:00.000Z");
    const remaining = Date.parse("2026-10-08T00:00:00.000Z") - Date.parse("2026-10-05T11:55:00.000Z");
    const projected = 0.4 + (0.4 * remaining) / elapsed;
    expect(body.pace!.projectedShare).toBeCloseTo(projected, 6);
    expect(body.pace!.expectedWaste).toBeCloseTo(1 - projected, 6);
    expect(body.pace!.projectedLimitHitAt).toBeNull();
    expect(body.pace!.points).toEqual([
      { at: "2026-10-05T11:55:00.000Z", usedShare: 0.4 },
      { at: "2026-10-08T00:00:00.000Z", usedShare: body.pace!.projectedShare },
    ]);
  });

  test("stretches without readings are gaps, from the Cycle's start; the last 5 minutes are not", async () => {
    seed();
    const { body } = await get("/api/hero/codex");
    expect(body.gaps).toEqual([
      { from: "2026-10-01T00:00:00.000Z", to: "2026-10-01T01:00:00.000Z" },
      { from: "2026-10-01T01:00:00.000Z", to: "2026-10-05T11:55:00.000Z" },
    ]);
  });

  test("a Pace that reaches the limit before the Reset bends flat at 100%", async () => {
    seed([reading("cursor", "Monthly", "cycle", 50, "2026-10-10T12:00:00.000Z", "2026-10-05T11:55:00.000Z")]);
    const store = openStore(dbPath);
    // A Cycle 10 days long: started 30 Sep 12:00, half used after ~5 days, Reset in ~5 days: on pace for 100%.
    store.saveReadings([
      {
        ...stored(reading("cursor", "Monthly", "cycle", 60, "2026-10-10T12:00:00.000Z", "2026-10-05T11:56:00.000Z")),
        periodMs: 10 * 24 * HOUR,
      },
    ]);
    store.close();
    const { body } = await get("/api/hero/cursor");
    expect(body.start).toBe("2026-09-30T12:00:00.000Z");
    const pace = body.pace!;
    expect(pace.projectedShare).toBe(1);
    expect(pace.projectedLimitHitAt).not.toBeNull();
    expect(pace.points.map((p) => p.usedShare)).toEqual([0.6, 1, 1]);
    expect(pace.points.at(-1)!.at).toBe("2026-10-10T12:00:00.000Z");
  });

  test("Estimated readings carry their basis; an ended Cycle has no Pace", async () => {
    seed();
    const { status, body } = await get("/api/hero/claude");
    expect(status).toBe(200);
    expect(body.running).toBe(false);
    expect(body.endedAt).toBe("2026-09-29T00:00:00.000Z");
    expect(body.pace).toBeNull();
    expect(body.readings.map((r) => r.basis)).toEqual(["estimated", "estimated"]);
  });

  test("?label= picks a Cycle line", async () => {
    seed([reading("codex", "Monthly", "cycle", 5, "2026-10-20T00:00:00.000Z", "2026-10-05T11:00:00.000Z")]);
    const weekly = await get("/api/hero/codex?label=Weekly");
    const monthly = await get("/api/hero/codex?label=Monthly");
    expect(weekly.body.label).toBe("Weekly");
    expect(monthly.body.label).toBe("Monthly");
    expect(monthly.body.labels.toSorted()).toEqual(["Monthly", "Weekly"]);
    expect((await get("/api/hero/codex?label=Daily")).status).toBe(404);
  });

  test("404 for an unknown Provider, a Provider without Cycles, or bad encoding", async () => {
    seed();
    expect((await get("/api/hero/nobody")).status).toBe(404);
    expect((await get("/api/hero/nobody")).body.error).toBe("No Cycle recorded for this Provider");
    expect((await get("/api/hero/%")).status).toBe(404);
  });

  test("an empty data directory has no hero", async () => {
    expect((await get("/api/hero/codex")).status).toBe(404);
  });
});
