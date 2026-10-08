import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { backfillTokens, type TokenSources } from "../src/backfill/tokens.ts";
import { openStore, type Store } from "../src/store.ts";

// Synthetic Claude Code and Codex logs only (ADR 0002): every value below is made up.

let root: string;
let store: Store;
let sources: TokenSources;
let repoDir: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "usage-insights-tokens-")));
  store = openStore(join(root, "usage.db"));
  sources = {
    claude: [
      { provider: "claude", dir: join(root, "claude", "projects") },
      { provider: "claude-work", dir: join(root, "claude-work", "projects") },
    ],
    codexDir: join(root, "codex", "sessions"),
  };
  repoDir = join(root, "code", "alpha");
  mkdirSync(join(repoDir, ".git"), { recursive: true });
  mkdirSync(join(repoDir, "src"), { recursive: true });
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, lines: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.map((l) => `${typeof l === "string" ? l : JSON.stringify(l)}\n`).join(""));
}

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}
const usage = (input: number, output: number, cacheWrite = 0, cacheRead = 0): Usage => ({
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: cacheWrite,
  cache_read_input_tokens: cacheRead,
});

function assistant(
  id: string,
  at: string,
  u: Usage,
  extra: { model?: string; cwd?: string; requestId?: string | null; sidechain?: boolean } = {},
): unknown {
  return {
    type: "assistant",
    isSidechain: extra.sidechain ?? false,
    timestamp: at,
    ...(extra.requestId === null ? {} : { requestId: extra.requestId ?? `req_${id}` }),
    message: { id: `msg_${id}`, model: extra.model ?? "claude-opus-5", role: "assistant", content: [{ type: "text", text: "<fake>" }], usage: u },
    sessionId: "00000000-0000-4000-8000-0000000000aa",
    cwd: extra.cwd ?? repoDir,
  };
}

const claudeLog = (provider: "claude" | "claude-work", relative: string) =>
  join(root, provider, "projects", relative);

test("one response written as several lines counts once, in its account's Provider", () => {
  write(claudeLog("claude", "-code-alpha/s1.jsonl"), [
    { type: "user", message: { role: "user", content: "<fake>" }, cwd: repoDir },
    assistant("A", "2026-10-08T10:00:00.000Z", usage(2, 400, 1000, 20000)),
    assistant("A", "2026-10-08T10:00:00.050Z", usage(2, 400, 1000, 20000)),
    assistant("A", "2026-10-08T10:00:00.090Z", usage(2, 400, 1000, 20000)),
  ]);
  write(claudeLog("claude-work", "-code-alpha/s2.jsonl"), [
    assistant("B", "2026-10-08T11:00:00.000Z", usage(10, 20), { model: "claude-sonnet-5" }),
  ]);

  const result = backfillTokens({ ...sources, store });

  expect(result.stored).toBe(2);
  expect(store.tokenUsage()).toEqual([
    { provider: "claude", at: "2026-10-08T10:00:00.000Z", project: repoDir, model: "claude-opus-5", input: 2, cacheWrite: 1000, cacheRead: 20000, output: 400 },
    { provider: "claude-work", at: "2026-10-08T11:00:00.000Z", project: repoDir, model: "claude-sonnet-5", input: 10, cacheWrite: 0, cacheRead: 0, output: 20 },
  ]);
});

test("sub-agent files are read, and a response copied into another file counts once at its earliest time", () => {
  write(claudeLog("claude", "-code-alpha/s1/subagents/agent-abc.jsonl"), [
    assistant("C", "2026-10-08T10:05:00.000Z", usage(500, 100, 0, 3000), { model: "claude-sonnet-5", sidechain: true }),
  ]);
  write(claudeLog("claude", "-code-alpha/s1.jsonl"), [
    assistant("C", "2026-10-08T10:01:00.000Z", usage(500, 100, 0, 3000), { model: "claude-sonnet-5" }),
  ]);

  backfillTokens({ ...sources, store });

  const events = store.tokenUsage();
  expect(events).toHaveLength(1);
  expect(events[0]!.at).toBe("2026-10-08T10:01:00.000Z");
});

test("the same message id with different request ids counts twice; a missing request id falls back to the message id", () => {
  write(claudeLog("claude", "-code-alpha/s1.jsonl"), [
    assistant("D", "2026-10-08T10:00:00.000Z", usage(1, 1), { requestId: "req_1" }),
    assistant("D", "2026-10-08T10:00:01.000Z", usage(1, 1), { requestId: "req_2" }),
    assistant("E", "2026-10-08T10:00:02.000Z", usage(1, 1), { requestId: null }),
    assistant("E", "2026-10-08T10:00:03.000Z", usage(1, 1), { requestId: null }),
  ]);
  backfillTokens({ ...sources, store });
  expect(store.tokenUsage()).toHaveLength(3);
});

test("API error lines, zero usage, other line types and bad lines are skipped", () => {
  write(claudeLog("claude", "-code-alpha/s1.jsonl"), [
    { ...(assistant("X", "2026-10-08T11:00:00.000Z", usage(0, 0), { model: "<synthetic>" }) as object), isApiErrorMessage: true },
    { type: "cost-state", totalCostUSD: 1 },
    "{not json",
    assistant("F", "2026-10-08T11:00:01.000Z", usage(3, 4)),
  ]);
  write(claudeLog("claude", "-code-alpha/s1/vercel-plugin/skill-injections.jsonl"), [{ skill: "x" }]);
  backfillTokens({ ...sources, store });
  expect(store.tokenUsage().map((e) => e.output)).toEqual([4]);
});

test("worktree and subfolder working directories group as their repository; others as no Project", () => {
  const gitdir = join(repoDir, ".git", "worktrees", "agent-1");
  mkdirSync(gitdir, { recursive: true });
  writeFileSync(join(gitdir, "commondir"), "../..\n");
  const wt = join(repoDir, ".claude", "worktrees", "agent-1");
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${gitdir}\n`);

  write(claudeLog("claude", "-code-alpha/s1.jsonl"), [
    assistant("G", "2026-10-08T10:00:00.000Z", usage(1, 1), { cwd: wt }),
    assistant("H", "2026-10-08T10:00:01.000Z", usage(1, 1), { cwd: join(repoDir, "src") }),
    assistant("I", "2026-10-08T10:00:02.000Z", usage(1, 1), { cwd: join(root, "tmp-scratch") }),
  ]);
  backfillTokens({ ...sources, store });
  expect(store.tokenUsage().map((e) => e.project)).toEqual([repoDir, repoDir, null]);
});

test("reruns read only appended lines and store nothing twice", () => {
  const path = claudeLog("claude", "-code-alpha/s1.jsonl");
  write(path, [assistant("J", "2026-10-08T10:00:00.000Z", usage(1, 1))]);
  expect(backfillTokens({ ...sources, store }).stored).toBe(1);

  const again = backfillTokens({ ...sources, store });
  expect(again).toMatchObject({ linesRead: 0, stored: 0 });

  appendFileSync(path, `${JSON.stringify(assistant("K", "2026-10-08T10:01:00.000Z", usage(1, 1)))}\n{"type":"assist`);
  const third = backfillTokens({ ...sources, store });
  expect(third).toMatchObject({ linesRead: 1, stored: 1 });
  expect(store.tokenUsage()).toHaveLength(2);
});

// Codex: model from the preceding turn_context, cwd from session_meta / turn_context, last_token_usage per call.

function codexMeta(cwd: string): unknown {
  return { timestamp: "2026-10-08T10:00:00.000Z", type: "session_meta", payload: { id: "00000000-0000-7000-8000-000000000001", cwd } };
}
function turn(model: string, cwd: string, at = "2026-10-08T10:00:01.000Z"): unknown {
  return { timestamp: at, type: "turn_context", payload: { cwd, model } };
}
function tokenCount(at: string, total: number, last: { input: number; cached: number; output: number } | null): unknown {
  return {
    timestamp: at,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: last && {
        total_token_usage: { input_tokens: total, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: total },
        last_token_usage: {
          input_tokens: last.input,
          cached_input_tokens: last.cached,
          cache_write_input_tokens: 0,
          output_tokens: last.output,
          reasoning_output_tokens: 0,
          total_tokens: last.input + last.output,
        },
      },
      rate_limits: null,
    },
  };
}
const CODEX_LOG = "2026/10/08/rollout-2026-10-08T12-00-00-00000000-0000-7000-8000-000000000001.jsonl";

test("Codex calls take the model of the preceding turn and count cached input separately", () => {
  write(join(sources.codexDir, CODEX_LOG), [
    codexMeta(repoDir),
    tokenCount("2026-10-08T10:00:00.500Z", 50, { input: 50, cached: 0, output: 0 }),
    turn("gpt-5.5", join(repoDir, "src")),
    tokenCount("2026-10-08T10:00:02.000Z", 0, null),
    tokenCount("2026-10-08T10:00:05.000Z", 4250, { input: 4000, cached: 3000, output: 200 }),
    tokenCount("2026-10-08T10:00:05.100Z", 4250, { input: 4000, cached: 3000, output: 200 }), // repeated event
    { timestamp: "2026-10-08T10:00:05.000Z", type: "token_usage_record", payload: { usage: { input_tokens: 4000, output_tokens: 200 } } },
  ]);

  backfillTokens({ ...sources, store });

  expect(store.tokenUsage()).toEqual([
    { provider: "codex", at: "2026-10-08T10:00:00.500Z", project: repoDir, model: "unknown", input: 50, cacheWrite: 0, cacheRead: 0, output: 0 },
    { provider: "codex", at: "2026-10-08T10:00:05.000Z", project: repoDir, model: "gpt-5.5", input: 1000, cacheWrite: 0, cacheRead: 3000, output: 200 },
  ]);
});

test("Codex reruns keep the model and cwd of turns read by an earlier run", () => {
  const path = join(sources.codexDir, CODEX_LOG);
  write(path, [codexMeta(join(root, "elsewhere")), turn("gpt-5.6-luna", repoDir)]);
  backfillTokens({ ...sources, store });

  appendFileSync(path, `${JSON.stringify(tokenCount("2026-10-08T10:00:09.000Z", 300, { input: 100, cached: 0, output: 200 }))}\n`);
  expect(backfillTokens({ ...sources, store }).stored).toBe(1);
  expect(store.tokenUsage()[0]).toMatchObject({ model: "gpt-5.6-luna", project: repoDir });
});

test("a Codex session in a deleted folder falls back to the repository named by its git remote", () => {
  const meta = (cwd: string, url?: string) => ({
    timestamp: "2026-10-08T10:00:00.000Z",
    type: "session_meta",
    payload: { cwd, ...(url ? { git: { repository_url: url } } : {}) },
  });
  const call = (at: string, total: number) => tokenCount(at, total, { input: 10, cached: 0, output: 0 });
  write(join(sources.codexDir, "2026/10/08/rollout-a.jsonl"), [meta(join(root, "gone"), "git@example.com:someone/beta.git"), call("2026-10-08T10:00:01.000Z", 10)]);
  write(join(sources.codexDir, "2026/10/08/rollout-b.jsonl"), [meta(join(root, "gone2"), "https://example.com/someone/gamma/"), call("2026-10-08T10:00:02.000Z", 10)]);
  write(join(sources.codexDir, "2026/10/08/rollout-c.jsonl"), [meta(join(repoDir, "src"), "https://example.com/someone/renamed.git"), call("2026-10-08T10:00:03.000Z", 10)]);
  write(join(sources.codexDir, "2026/10/08/rollout-d.jsonl"), [meta(join(root, "gone3")), call("2026-10-08T10:00:04.000Z", 10)]);

  backfillTokens({ ...sources, store });

  expect(store.tokenUsage().map((e) => e.project)).toEqual(["beta", "gamma", repoDir, null]);
});

test("missing log directories are fine", () => {
  rmSync(join(root, "code"), { recursive: true });
  expect(backfillTokens({ ...sources, store })).toEqual({ files: 0, linesRead: 0, stored: 0 });
});
