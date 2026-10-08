import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDueBackfills } from "../src/backfill/jobs.ts";
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
