import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { backfillTokens, type TokenSources } from "../src/backfill/tokens.ts";
import { MIGRATIONS, openStore, type Store } from "../src/store.ts";

// Ticket #21: token events carry their session, filled by the token Backfill (synthetic logs only).

let root: string;
let dbPath: string;
let store: Store;
let sources: TokenSources;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "usage-insights-session-tokens-")));
  dbPath = join(root, "usage.db");
  store = openStore(dbPath);
  sources = {
    claude: [{ provider: "claude", dir: join(root, "claude", "projects") }],
    codexDir: join(root, "codex", "sessions"),
  };
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, lines: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
}

const CLAUDE_SESSION = "00000000-0000-4000-8000-0000000000aa";
const CODEX_SESSION = "00000000-0000-7000-8000-000000000001";
const CODEX_LOG = `2026/10/08/rollout-2026-10-08T12-00-00-${CODEX_SESSION}.jsonl`;

function assistant(id: string, at: string, sessionId = CLAUDE_SESSION): unknown {
  return {
    type: "assistant",
    timestamp: at,
    requestId: `req_${id}`,
    message: { id: `msg_${id}`, model: "claude-opus-5", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 5 } },
    sessionId,
    cwd: "/nowhere",
  };
}

function codexLines(meta = true): unknown[] {
  return [
    ...(meta
      ? [{ timestamp: "2026-10-08T10:00:00.000Z", type: "session_meta", payload: { id: CODEX_SESSION, cwd: "/nowhere" } }]
      : []),
    { timestamp: "2026-10-08T10:00:01.000Z", type: "turn_context", payload: { cwd: "/nowhere", model: "gpt-5.5" } },
    {
      timestamp: "2026-10-08T10:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { total_tokens: 100 },
          last_token_usage: { input_tokens: 80, cached_input_tokens: 0, output_tokens: 20 },
        },
        rate_limits: null,
      },
    },
  ];
}

test("the token Backfill stores each call's session: Claude's sessionId, Codex's session_meta id", () => {
  write(join(sources.claude[0]!.dir, "-p/s.jsonl"), [assistant("A", "2026-10-08T09:00:00.000Z")]);
  write(join(sources.codexDir, CODEX_LOG), codexLines());

  backfillTokens({ ...sources, store });

  expect(store.sessionTokenUsage().map((e) => [e.provider, e.session])).toEqual([
    ["claude", CLAUDE_SESSION],
    ["codex", CODEX_SESSION],
  ]);
});

test("a Codex log without session_meta falls back to the id in its file name", () => {
  write(join(sources.codexDir, CODEX_LOG), codexLines(false));
  backfillTokens({ ...sources, store });
  expect(store.sessionTokenUsage().map((e) => e.session)).toEqual([CODEX_SESSION]);
});

test("a stored event without a session gets it when the same call is read again; keys stay the same", () => {
  store.saveTokenEvents([
    { key: "k1", provider: "claude", at: "2026-10-08T09:00:00.000Z", project: null, model: "m", input: 1, cacheWrite: 0, cacheRead: 0, output: 0 },
  ]);
  const again = { key: "k1", provider: "claude", at: "2026-10-08T09:00:00.000Z", project: null, model: "m", input: 1, cacheWrite: 0, cacheRead: 0, output: 0 };
  expect(store.saveTokenEvents([{ ...again, session: "s1" }])).toBe(0);
  // A later read never overwrites the session it already has.
  store.saveTokenEvents([{ ...again, session: "s2" }]);
  expect(store.sessionTokenUsage().map((e) => e.session)).toEqual(["s1"]);
});

test("upgrading a data file resets the token Backfill's progress, so the next run fills sessions in", () => {
  store.close();
  dbPath = join(root, "old.db");
  // A data file from before sessions: the call already stored, its log read to the end.
  write(join(sources.claude[0]!.dir, "-p/s.jsonl"), [assistant("A", "2026-10-08T09:00:00.000Z")]);
  const old = new Database(dbPath);
  for (const m of MIGRATIONS.slice(0, -1)) old.exec(m);
  old.exec(`PRAGMA user_version = ${MIGRATIONS.length - 1}`);
  old.exec(`INSERT INTO token_events (key, provider, at, project, model, input, cache_write, cache_read, output)
            VALUES ('claude:msg_A:req_A', 'claude', '2026-10-08T09:00:00.000Z', NULL, 'claude-opus-5', 10, 0, 0, 5)`);
  old.exec("INSERT INTO backfill_progress (source, path, offset) VALUES ('tokens:claude', '-p/s.jsonl', 999)");
  old.exec("INSERT INTO backfill_progress (source, path, offset) VALUES ('backfill:codex', 'x.jsonl', 42)");
  old.close();

  store = openStore(dbPath);
  expect(store.backfillProgress("tokens:claude", "-p/s.jsonl")).toBeNull();
  expect(store.backfillProgress("backfill:codex", "x.jsonl")?.offset).toBe(42);

  const result = backfillTokens({ ...sources, store });

  expect(result.stored).toBe(0); // nothing counted twice
  expect(store.sessionTokenUsage().map((e) => e.session)).toEqual([CLAUDE_SESSION]);
});
