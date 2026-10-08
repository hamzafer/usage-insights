import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.ts";

const dir = mkdtempSync(join(tmpdir(), "usage-insights-test-"));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("reopening an existing data file keeps its readings and gaps", () => {
  const path = join(dir, "usage.db");
  const first = openStore(path);
  first.saveReadings([
    {
      provider: "codex",
      label: "Weekly",
      role: "cycle",
      used: 40,
      limit: 100,
      unit: "percent",
      resetsAt: "2026-01-09T08:00:00.000Z",
      periodMs: 604_800_000,
      plan: "Plus",
      fetchedAt: "2026-01-05T10:00:00.000Z",
      recordedAt: "2026-01-05T10:00:05.000Z",
    },
  ]);
  first.saveGap({ recordedAt: "2026-01-05T10:05:00.000Z", reason: "timeout" });
  first.close();

  const second = openStore(path);
  expect(second.countReadings()).toBe(1);
  expect(second.recentGaps(5)).toHaveLength(1);
  second.close();
});

test("readingsWithRole lists readings of the given roles with their source, oldest first", () => {
  const path = join(mkdtempSync(join(tmpdir(), "usage-insights-test-")), "usage.db");
  const store = openStore(path);
  const base = {
    provider: "codex",
    unit: "percent",
    limit: 100,
    periodMs: null,
    plan: null,
    recordedAt: "2026-01-05T10:00:05.000Z",
  };
  store.saveReadings([
    { ...base, label: "Weekly", role: "cycle", used: 50, resetsAt: "2026-01-09T08:00:00.000Z", fetchedAt: "2026-01-06T10:00:00.000Z" },
    { ...base, label: "Weekly", role: "cycle", used: 40, resetsAt: "2026-01-09T08:00:00.000Z", fetchedAt: "2026-01-05T10:00:00.000Z" },
    { ...base, label: "Session", role: "session", used: 5, resetsAt: null, fetchedAt: "2026-01-05T10:00:00.000Z" },
  ]);

  const weekly = { provider: "codex", label: "Weekly", role: "cycle" as const, limit: 100, resetsAt: "2026-01-09T08:00:00.000Z", source: "openusage", periodMs: null };
  expect(store.readingsWithRole(["cycle"])).toEqual([
    { ...weekly, used: 40, fetchedAt: "2026-01-05T10:00:00.000Z" },
    { ...weekly, used: 50, fetchedAt: "2026-01-06T10:00:00.000Z" },
  ]);
  expect(store.readingsWithRole(["cycle", "session"])).toHaveLength(3);
  store.close();
});

test("run outcomes: newest first, failures with their reason, and the last run time per job", () => {
  const store = openStore(join(mkdtempSync(join(tmpdir(), "usage-insights-test-")), "usage.db"));
  expect(store.lastRunAt("backfill:codex")).toBeNull();
  store.saveRun({ job: "backfill:codex", at: "2026-01-05T10:00:00.000Z", ok: true, reason: null });
  store.saveRun({ job: "report", at: "2026-01-05T11:00:00.000Z", ok: false, reason: "database is locked" });
  store.saveRun({ job: "backfill:codex", at: "2026-01-05T12:00:00.000Z", ok: false, reason: "unreadable" });
  expect(store.recentRuns(2)).toEqual([
    { job: "backfill:codex", at: "2026-01-05T12:00:00.000Z", ok: false, reason: "unreadable" },
    { job: "report", at: "2026-01-05T11:00:00.000Z", ok: false, reason: "database is locked" },
  ]);
  expect(store.lastRunAt("backfill:codex")).toBe("2026-01-05T12:00:00.000Z");
  store.close();
});
