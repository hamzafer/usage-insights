import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { incrementalBackfills, runDueBackfills } from "../src/backfill/jobs.ts";
import { openStore } from "../src/store.ts";

const HOUR = 3_600_000;

function setup() {
  const store = openStore(join(mkdtempSync(join(tmpdir(), "usage-insights-jobs-")), "usage.db"));
  const ran: string[] = [];
  const logged: string[] = [];
  const backfills = [
    { name: "Codex", job: "backfill:codex", run: () => void ran.push("codex") },
    { name: "Token", job: "backfill:tokens", run: () => void ran.push("tokens") },
  ];
  return { store, ran, logged, backfills, log: (l: string) => void logged.push(l) };
}

test("the automatic Backfills run at most once per hour, timed by the store", async () => {
  const { store, ran, backfills, log } = setup();
  let now = new Date("2026-10-08T10:00:00.000Z");
  const clock = () => now;

  await runDueBackfills({ backfills, store, now: clock, log });
  expect(ran).toEqual(["codex", "tokens"]);

  now = new Date(now.getTime() + 59 * 60_000);
  await runDueBackfills({ backfills, store, now: clock, log });
  expect(ran).toEqual(["codex", "tokens"]);

  now = new Date(now.getTime() + HOUR);
  await runDueBackfills({ backfills, store, now: clock, log });
  expect(ran).toEqual(["codex", "tokens", "codex", "tokens"]);
  expect(store.recentRuns(10)).toHaveLength(4);
  store.close();
});

test("a failing Backfill is recorded and logged, never thrown, and the next one still runs", async () => {
  const { store, ran, logged, log } = setup();
  const backfills = [
    { name: "Codex", job: "backfill:codex", run: () => { throw new Error("sessions dir unreadable"); } },
    { name: "Token", job: "backfill:tokens", run: () => void ran.push("tokens") },
  ];
  const now = () => new Date("2026-10-08T10:00:00.000Z");
  await runDueBackfills({ backfills, store, now, log });
  expect(ran).toEqual(["tokens"]);
  expect(logged).toEqual(["Codex Backfill failed: sessions dir unreadable"]);
  expect(store.recentRuns(10).find((r) => r.job === "backfill:codex")).toEqual({
    job: "backfill:codex",
    at: "2026-10-08T10:00:00.000Z",
    ok: false,
    reason: "sessions dir unreadable",
  });
  store.close();
});

test("an async Backfill is finished before its success is recorded; a rejected one is recorded as failed", async () => {
  const { store, logged, log } = setup();
  let finished = false;
  const backfills = [
    { name: "Codex", job: "backfill:codex", run: async () => { await Bun.sleep(30); finished = true; } },
    { name: "Token", job: "backfill:tokens", run: async () => { await Bun.sleep(10); throw new Error("logs unreadable"); } },
  ];
  await runDueBackfills({ backfills, store, now: () => new Date("2026-10-08T10:00:00.000Z"), log });
  expect(finished).toBe(true);
  expect(store.recentRuns(10).map((r) => [r.job, r.ok, r.reason])).toEqual([
    ["backfill:tokens", false, "logs unreadable"],
    ["backfill:codex", true, null],
  ]);
  expect(logged).toEqual(["Token Backfill failed: logs unreadable"]);
  store.close();
});

test("the real Backfills' failures reach runDueBackfills and are recorded", async () => {
  const { store, log } = setup();
  const failing = {
    ...store,
    livePlan: () => null,
    backfillProgress: () => {
      throw new Error("progress unreadable");
    },
  };
  const root = mkdtempSync(join(tmpdir(), "usage-insights-jobs-"));
  const sessions = join(root, "sessions");
  mkdirSync(sessions);
  writeFileSync(join(sessions, "rollout-a.jsonl"), "{}\n");
  const backfills = incrementalBackfills({ codexSessionsDir: sessions, claudeProjectDirs: [] }, () => failing);
  await runDueBackfills({ backfills, store, now: () => new Date("2026-10-08T10:00:00.000Z"), log });
  expect(store.recentRuns(10).map((r) => [r.job, r.ok, r.reason])).toEqual([
    ["backfill:tokens", false, "progress unreadable"],
    ["backfill:codex", false, "progress unreadable"],
  ]);
  store.close();
});

test("a store that cannot say when a job last ran does not throw", async () => {
  const { backfills, logged, log } = setup();
  const broken = {
    lastRunAt: () => {
      throw new Error("database is locked");
    },
    saveRun: () => {},
  };
  expect(await runDueBackfills({ backfills, store: broken, now: () => new Date(), log })).toEqual([]);
  expect(logged).toEqual(["Codex Backfill not run: database is locked", "Token Backfill not run: database is locked"]);
});
