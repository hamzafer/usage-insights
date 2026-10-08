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
