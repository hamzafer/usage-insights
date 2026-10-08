import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { record } from "../src/recorder.ts";
import type { ProviderReading, SnapshotSource } from "../src/snapshot-source.ts";
import { openStore, type Store } from "../src/store.ts";

function fakeSource(readings: ProviderReading[]): SnapshotSource {
  return { fetch: async () => readings };
}

function failingSource(message: string): SnapshotSource {
  return {
    fetch: async () => {
      throw new Error(message);
    },
  };
}

const claude: ProviderReading = {
  providerId: "claude",
  displayName: "Claude",
  plan: "Pro",
  fetchedAt: "2026-01-05T10:00:00.000Z",
  lines: [
    {
      label: "Session",
      used: 12,
      limit: 100,
      unit: "percent",
      resetsAt: "2026-01-05T13:00:00.000Z",
      periodMs: 18_000_000,
    },
    {
      label: "Weekly",
      used: 30,
      limit: 100,
      unit: "percent",
      resetsAt: "2026-01-09T08:00:00.000Z",
      periodMs: 604_800_000,
    },
    {
      label: "Monthly bonus",
      used: 1,
      limit: 5,
      unit: "count",
      resetsAt: null,
      periodMs: null,
    },
  ],
};

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-insights-test-"));
  store = openStore(join(dir, "usage.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("record", () => {
  test("stores every progress line of every Provider with its role", async () => {
    const result = await record(fakeSource([claude]), store, new Date("2026-01-05T10:00:05Z"));

    expect(result).toEqual({ ok: true, stored: 3 });
    const latest = store.latestReadings();
    expect(latest.map((r) => [r.provider, r.label, r.role, r.used])).toEqual([
      ["claude", "Monthly bonus", "unclassified", 1],
      ["claude", "Session", "session", 12],
      ["claude", "Weekly", "cycle", 30],
    ]);
    expect(latest[1]).toMatchObject({
      limit: 100,
      unit: "percent",
      resetsAt: "2026-01-05T13:00:00.000Z",
      periodMs: 18_000_000,
      plan: "Pro",
      fetchedAt: "2026-01-05T10:00:00.000Z",
      recordedAt: "2026-01-05T10:00:05.000Z",
    });
  });

  test("re-recording the same reading is a no-op", async () => {
    await record(fakeSource([claude]), store, new Date("2026-01-05T10:00:05Z"));
    const second = await record(fakeSource([claude]), store, new Date("2026-01-05T10:05:05Z"));

    expect(second).toEqual({ ok: true, stored: 0 });
    expect(store.countReadings()).toBe(3);
  });

  test("a newer reading is stored and becomes the latest", async () => {
    await record(fakeSource([claude]), store, new Date("2026-01-05T10:00:05Z"));
    const later: ProviderReading = {
      ...claude,
      fetchedAt: "2026-01-05T10:05:00.000Z",
      lines: claude.lines.map((l) => (l.label === "Session" ? { ...l, used: 20 } : l)),
    };
    await record(fakeSource([later]), store, new Date("2026-01-05T10:05:05Z"));

    expect(store.countReadings()).toBe(6);
    const session = store.latestReadings().find((r) => r.label === "Session");
    expect(session?.used).toBe(20);
  });

  test("when the source is unreachable a gap with the reason is stored", async () => {
    const result = await record(
      failingSource("connect ECONNREFUSED"),
      store,
      new Date("2026-01-05T10:10:00Z"),
    );

    expect(result).toEqual({ ok: false, reason: "connect ECONNREFUSED" });
    expect(store.recentGaps(10)).toEqual([
      { recordedAt: "2026-01-05T10:10:00.000Z", reason: "connect ECONNREFUSED" },
    ]);
    expect(store.countReadings()).toBe(0);
  });
});
