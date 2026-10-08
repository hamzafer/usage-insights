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
