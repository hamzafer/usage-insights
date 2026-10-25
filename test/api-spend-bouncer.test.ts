import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importBouncerSpend } from "../src/api-spend/bouncer.ts";
import { type ApiSpendRow } from "../src/store.ts";

let dir: string;
let rows: ApiSpendRow[];
const store = { setApiSpend: (r: ApiSpendRow) => void rows.push(r) };
const NOW = new Date("2026-10-25T12:00:00Z");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-insights-bouncer-"));
  rows = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const usage = { date: "2026-10-25", calls: 12, allow: 9, ask: 3, failed: 0, cost_usd: 0.0123, input_tokens: 40_000, output_tokens: 900 };
const write = (name: string, value: unknown) => writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value));

test("imports today's totals as the bouncer on the default key", () => {
  write("judge-usage.json", usage);
  expect(importBouncerSpend(dir, store, NOW)).toEqual({ ok: true, imported: true, message: "bouncer 12 calls on personal" });
  expect(rows).toEqual([
    {
      day: "2026-10-25",
      key: "personal",
      caller: "bouncer",
      model: "claude-haiku-5-5",
      calls: 12,
      input: 40_000,
      cacheWrite: 0,
      cacheRead: 0,
      output: 900,
      costUsd: 0.0123,
      updatedAt: NOW.toISOString(),
    },
  ]);
});

test("the key comes from mode.json's key_service", () => {
  write("judge-usage.json", usage);
  write("mode.json", { mode: "auto", key_service: "anthropic-api-key-work", trusted: { secret: "do-not-log" } });
  const result = importBouncerSpend(dir, store, NOW);
  expect(rows[0]!.key).toBe("work");
  expect(JSON.stringify(result)).not.toContain("do-not-log");
});

test("a damaged mode.json falls back to the default key service", () => {
  write("judge-usage.json", usage);
  write("mode.json", "{not json");
  importBouncerSpend(dir, store, NOW);
  expect(rows[0]!.key).toBe("personal");
});

test("a missing judge-usage.json records nothing", () => {
  expect(importBouncerSpend(dir, store, NOW)).toEqual({ ok: true, imported: false, message: "no bouncer usage file" });
  expect(rows).toEqual([]);
});

test("a damaged judge-usage.json gives a reason and records nothing, never throws", () => {
  write("judge-usage.json", "{not json");
  const result = importBouncerSpend(dir, store, NOW);
  expect(result.ok).toBe(false);
  expect(result.message).toStartWith("bouncer usage file unreadable");
  write("judge-usage.json", { ...usage, calls: "many" });
  expect(importBouncerSpend(dir, store, NOW).ok).toBe(false);
  write("judge-usage.json", { ...usage, date: "yesterday-ish" });
  expect(importBouncerSpend(dir, store, NOW).ok).toBe(false);
  expect(rows).toEqual([]);
});

test("an unreadable file (a directory) is reported, never thrown", () => {
  mkdirSync(join(dir, "judge-usage.json"));
  expect(importBouncerSpend(dir, store, NOW).ok).toBe(false);
});

test("a store failure is reported, never thrown", () => {
  write("judge-usage.json", usage);
  const failing = {
    setApiSpend: () => {
      throw new Error("readonly database");
    },
  };
  expect(importBouncerSpend(dir, failing, NOW)).toEqual({ ok: false, imported: false, message: "bouncer usage not stored: readonly database" });
});
