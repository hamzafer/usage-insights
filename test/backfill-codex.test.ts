import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { backfillCodex } from "../src/backfill/codex.ts";
import { openStore, type Store } from "../src/store.ts";

// Synthetic Codex session logs only (ADR 0002): every value below is made up.

let root: string;
let sessionsDir: string;
let store: Store;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "usage-insights-test-"));
  sessionsDir = join(root, "sessions");
  store = openStore(join(root, "usage.db"));
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

const NOW = new Date("2026-10-08T12:00:00.000Z");
/** 2026-10-08T14:00:00Z and 2026-10-12T00:00:00Z as epoch seconds. */
const SESSION_RESET = Date.parse("2026-10-08T14:00:00Z") / 1000;
const WEEKLY_RESET = Date.parse("2026-10-12T00:00:00Z") / 1000;

function sessionMeta(at: string): string {
  return JSON.stringify({ timestamp: at, type: "session_meta", payload: { id: "00000000-0000-7000-8000-000000000001", cwd: "/example" } });
}

interface Win {
  used_percent: number;
  window_minutes: number;
  resets_at: number | null;
}

function tokenCount(
  at: string,
  primary: Win | null,
  secondary: Win | null,
  extra: { limit_id?: string | null; plan_type?: string | null; info?: unknown } = {},
): string {
  return JSON.stringify({
    timestamp: at,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: extra.info ?? null,
      rate_limits: {
        limit_id: extra.limit_id === undefined ? "codex" : extra.limit_id,
        limit_name: null,
        primary,
        secondary,
        credits: null,
        plan_type: extra.plan_type === undefined ? "team" : extra.plan_type,
      },
    },
  });
}

const session = (used: number, resets_at: number | null = SESSION_RESET): Win => ({ used_percent: used, window_minutes: 300, resets_at });
const weekly = (used: number, resets_at: number | null = WEEKLY_RESET): Win => ({ used_percent: used, window_minutes: 10080, resets_at });

function writeLog(relative: string, lines: string[]): string {
  const path = join(sessionsDir, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.map((l) => `${l}\n`).join(""));
  return path;
}

const LOG = "2026/10/08/rollout-2026-10-08T12-00-00-00000000-0000-7000-8000-000000000001.jsonl";

test("token_count rate limits become Session and Weekly readings with a backfill source", () => {
  writeLog(LOG, [sessionMeta("2026-10-08T10:00:00.000Z"), tokenCount("2026-10-08T10:00:05.000Z", session(12), weekly(34))]);

  const result = backfillCodex({ sessionsDir, store, now: NOW });

  expect(result.stored).toBe(2);
  const base = { provider: "codex", limit: 100, fetchedAt: "2026-10-08T10:00:05.000Z", source: "backfill:codex" };
  expect(store.readingsWithRole(["session", "cycle"])).toEqual([
    { ...base, label: "Session", role: "session", used: 12, resetsAt: "2026-10-08T14:00:00.000Z" },
    { ...base, label: "Weekly", role: "cycle", used: 34, resetsAt: "2026-10-12T00:00:00.000Z" },
  ]);
});

test("a rerun reads only what was appended since, and finishes a line that was still being written", () => {
  const path = writeLog(LOG, [sessionMeta("2026-10-08T10:00:00.000Z"), tokenCount("2026-10-08T10:00:05.000Z", session(12), weekly(34))]);
  const half = tokenCount("2026-10-08T10:05:00.000Z", session(15), weekly(35));
  appendFileSync(path, half.slice(0, 40));

  expect(backfillCodex({ sessionsDir, store, now: NOW })).toEqual({ files: 1, linesRead: 2, stored: 2 });
  expect(backfillCodex({ sessionsDir, store, now: NOW })).toEqual({ files: 1, linesRead: 0, stored: 0 });

  appendFileSync(path, `${half.slice(40)}\n`);
  writeLog("2026/10/08/rollout-2026-10-08T13-00-00-b.jsonl", [tokenCount("2026-10-08T11:00:00.000Z", session(20), weekly(36))]);
  expect(backfillCodex({ sessionsDir, store, now: NOW })).toEqual({ files: 2, linesRead: 2, stored: 4 });
  expect(store.readingsWithRole(["cycle"]).map((r) => r.used)).toEqual([34, 35, 36]);
});

test("the same readings logged twice (sub-agent logs, reruns) are stored once", () => {
  const line = tokenCount("2026-10-08T10:00:05.000Z", session(12), weekly(34));
  writeLog(LOG, [line, line]);
  writeLog("2026/10/08/rollout-2026-10-08T12-00-01-subagent.jsonl", [line]);

  expect(backfillCodex({ sessionsDir, store, now: NOW }).stored).toBe(2);
  expect(store.countReadings()).toBe(2);
});

test("skips lines it cannot measure: no Reset (2025), no windows, other limits, broken JSON", () => {
  writeLog("2025/10/02/rollout-2025-10-02T13-00-00-a.jsonl", [
    sessionMeta("2025-10-02T11:00:00.000Z"),
    tokenCount("2025-10-02T11:15:27.205Z", { used_percent: 5, window_minutes: 299, resets_at: null }, { used_percent: 9, window_minutes: 10079, resets_at: null }, { limit_id: null, plan_type: null }),
  ]);
  writeLog(LOG, [
    sessionMeta("2026-10-08T10:00:00.000Z"),
    '{"timestamp":"2026-10-08T10:00:01.000Z","type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":null}}',
    tokenCount("2026-10-08T10:00:02.000Z", null, null, { limit_id: "premium", plan_type: null }),
    tokenCount("2026-10-08T10:00:03.000Z", session(80), weekly(80), { limit_id: "other" }),
    '{"timestamp":"2026-10-08T10:00:04.000Z","type":"token_usage_record","payload":{"usage":{"total_tokens":1}}}',
    '{"timestamp":"2026-10-08T10:00:04.500Z","type":"event_msg","payload":{"type":"token_cou',
    // Older logs: 299 / 10079 minutes and no plan. Then a weekly-only line in `primary`.
    tokenCount("2026-10-08T10:00:05.000Z", { used_percent: 12, window_minutes: 299, resets_at: SESSION_RESET }, { used_percent: 34, window_minutes: 10079, resets_at: WEEKLY_RESET }, { limit_id: null, plan_type: null }),
    tokenCount("2026-10-08T10:00:06.000Z", weekly(35), null),
  ]);
  writeLog("2025/09/06/rollout-2025-09-06T19-47-49-legacy.jsonl", ['{"id":"x","timestamp":"2025-09-06T17:47:49.000Z","instructions":null}', '{"record_type":"state"}']);

  const result = backfillCodex({ sessionsDir, store, now: NOW });

  expect(result.stored).toBe(3);
  expect(store.readingsWithRole(["session", "cycle"]).map((r) => [r.label, r.used, r.fetchedAt])).toEqual([
    ["Session", 12, "2026-10-08T10:00:05.000Z"],
    ["Weekly", 34, "2026-10-08T10:00:05.000Z"],
    ["Weekly", 35, "2026-10-08T10:00:06.000Z"],
  ]);
});
