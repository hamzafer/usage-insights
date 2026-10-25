import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ApiSpendRow, Store } from "../store.ts";
import { keyNameFromService } from "./keys.ts";

/**
 * Imports the Bouncer's (reason-bridge's auto-mode judge) own daily totals as API Spend (spec:
 * Recording). `judge-usage.json` holds only today, so the row of that day is replaced on every run.
 * `mode.json` is read only for `key_service`, to name the Key; its other contents are never used or
 * logged. Nothing here throws: the Recorder run goes on whatever the files hold.
 */

/**
 * Mirrors reason-bridge's judge model (its `Model` constant); its cost is already priced in the file.
 * The file's `cost_usd` already includes reason-bridge's worst-case estimate (`EstimatedCallUSD`) for
 * calls whose cost the API did not report (`UnknownCost`), so it can only overstate, never understate.
 */
const BOUNCER_MODEL = "claude-haiku-5-5";
const DEFAULT_KEY_SERVICE = "anthropic-api-key-personal";

export interface BouncerImport {
  ok: boolean;
  /** True when a row was stored. */
  imported: boolean;
  /** One short line for the log. */
  message: string;
}

export function importBouncerSpend(dir: string, store: Pick<Store, "setApiSpend">, now: Date): BouncerImport {
  let row: ApiSpendRow;
  try {
    const raw = readFile(join(dir, "judge-usage.json"));
    if (raw === null) return { ok: true, imported: false, message: "no bouncer usage file" };
    row = parseUsage(raw, keyName(dir), now);
  } catch (e) {
    return { ok: false, imported: false, message: `bouncer usage file unreadable: ${e instanceof Error ? e.message : String(e)}` };
  }
  try {
    store.setApiSpend(row);
  } catch (e) {
    return { ok: false, imported: false, message: `bouncer usage not stored: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ok: true, imported: true, message: `bouncer ${row.calls} calls on ${row.key}` };
}

function parseUsage(raw: string, key: string, now: Date): ApiSpendRow {
  const data: unknown = JSON.parse(raw);
  if (typeof data !== "object" || data === null) throw new Error("not an object");
  // reason-bridge writes the token counts with Go `omitempty`: zero means absent, not damaged.
  const field = (name: string, optional = false): number => {
    const value = (data as Record<string, unknown>)[name];
    if (optional && value === undefined) return 0;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${name} is not a number`);
    return value;
  };
  const day = (data as Record<string, unknown>).date;
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("date is not YYYY-MM-DD");
  return {
    day,
    key,
    caller: "bouncer",
    model: BOUNCER_MODEL,
    calls: field("calls"),
    input: field("input_tokens", true),
    cacheWrite: 0,
    cacheRead: 0,
    output: field("output_tokens", true),
    costUsd: field("cost_usd"),
    updatedAt: now.toISOString(),
  };
}

/** The Key name from mode.json's `key_service`; the default when the file is missing, damaged or has none. */
function keyName(dir: string): string {
  let service = DEFAULT_KEY_SERVICE;
  try {
    const mode: unknown = JSON.parse(readFile(join(dir, "mode.json")) ?? "null");
    const value = typeof mode === "object" && mode !== null ? (mode as Record<string, unknown>).key_service : undefined;
    if (typeof value === "string" && value) service = value;
  } catch {
    // Damaged: keep the default.
  }
  return keyNameFromService(service);
}

/** The file's text; null when it does not exist. Other read errors propagate to the caller's report. */
function readFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return null;
    throw e;
  }
}
