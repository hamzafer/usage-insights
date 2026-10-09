import { Glob } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createProjectResolver, type ProjectResolver } from "../projects.ts";
import type { KeyedTokenEvent, Store } from "../store.ts";
import { type NewLines, readNewLines } from "./log-reader.ts";

/**
 * Token Backfill (spec §4, ticket #7): tokens per API call, Project and model, from Claude Code
 * transcripts (`<projects dir>/**\/*.jsonl`, sub-agent files included) and Codex session logs
 * (`<sessions dir>/**\/rollout-*.jsonl`). Rerunnable and incremental: each file is read from
 * where the last run stopped, and every call is stored once.
 */

export interface ClaudeTokenSource {
  /** `claude` (personal account) or `claude-work`. */
  provider: string;
  /** A Claude Code `projects` directory. */
  dir: string;
}

export interface TokenSources {
  claude: ClaudeTokenSource[];
  codexDir: string;
}

export interface TokenBackfillOptions extends TokenSources {
  store: Store;
  resolver?: ProjectResolver;
}

export interface TokenBackfillResult {
  /** Log files found. */
  files: number;
  /** Complete lines read by this run (only what was appended since the last run). */
  linesRead: number;
  /** API calls stored for the first time. */
  stored: number;
}

export const CODEX_PROVIDER = "codex";
export const UNKNOWN_MODEL = "unknown";

export function backfillTokens({ claude, codexDir, store, resolver = createProjectResolver() }: TokenBackfillOptions): TokenBackfillResult {
  const result: TokenBackfillResult = { files: 0, linesRead: 0, stored: 0 };
  const add = (r: { linesRead: number; stored: number }) => {
    result.files++;
    result.linesRead += r.linesRead;
    result.stored += r.stored;
  };
  for (const source of claude) {
    for (const file of logFiles(source.dir, "**/*.jsonl")) {
      add(readFile(store, `tokens:${source.provider}`, source.dir, file, (read) => ({
        events: read.lines.flatMap((line) => claudeEvent(line, source.provider, resolver)),
        context: null,
      })));
    }
  }
  for (const file of logFiles(codexDir, "**/rollout-*.jsonl")) {
    add(readFile(store, `tokens:${CODEX_PROVIDER}`, codexDir, file, (read) => codexEvents(file, read, resolver)));
  }
  return result;
}

function logFiles(dir: string, pattern: string): string[] {
  if (!existsSync(dir)) return [];
  return [...new Glob(pattern).scanSync({ cwd: dir, onlyFiles: true })].toSorted();
}

/** Hands the lines appended since the last run to `parse`, stores its events and saves its state. */
function readFile(
  store: Store,
  source: string,
  dir: string,
  relative: string,
  parse: (read: NewLines) => { events: KeyedTokenEvent[]; context: string | null },
): { linesRead: number; stored: number } {
  const read = readNewLines(store, source, join(dir, relative), relative);
  if (!read) return { linesRead: 0, stored: 0 };
  const { events, context } = parse(read);
  const stored = store.saveTokenEvents(events);
  read.done(context);
  return { linesRead: read.lines.length, stored };
}

function parse(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function count(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * One Claude Code assistant line. A response is written as one line per content block, all with
 * the same message and request id and usage, and reappears in forked and sub-agent files: the
 * key makes it count once.
 */
function claudeEvent(line: string, provider: string, resolver: ProjectResolver): KeyedTokenEvent[] {
  if (!line.includes('"assistant"') || !line.includes('"usage"')) return [];
  const entry = parse(line);
  const message = entry?.message;
  if (entry?.type !== "assistant" || !message || typeof message !== "object" || entry.isApiErrorMessage) return [];
  if (typeof message.id !== "string" || typeof entry.timestamp !== "string") return [];
  const u = message.usage ?? {};
  const event = {
    input: count(u.input_tokens),
    cacheWrite: count(u.cache_creation_input_tokens),
    cacheRead: count(u.cache_read_input_tokens),
    output: count(u.output_tokens),
  };
  if (event.input + event.cacheWrite + event.cacheRead + event.output === 0) return [];
  const requestId = typeof entry.requestId === "string" ? entry.requestId : "";
  const session = [entry.sessionId, entry.session_id].find((s) => typeof s === "string" && s) ?? null;
  return [
    {
      key: `claude:${message.id}:${requestId}`,
      session,
      provider,
      at: new Date(entry.timestamp).toISOString(),
      project: resolver.resolve(typeof entry.cwd === "string" ? entry.cwd : ""),
      model: typeof message.model === "string" && message.model ? message.model : UNKNOWN_MODEL,
      ...event,
    },
  ];
}

/**
 * The repository name of a git remote URL (`git@host:me/beta.git`, `https://host/me/beta/`), so a
 * Codex session whose folder was deleted still lands in its Project. Null when there is none.
 */
function repoName(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const name = url.trim().replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).at(-1);
  return name ? name : null;
}

/**
 * Codex calls: each `token_count` with usage is one call (`last_token_usage`), attributed to the
 * model and cwd of the latest turn before it. A repeated event (same cumulative total) is the
 * same call. `token_usage_record` lines duplicate `token_count` and are not read.
 */
function codexEvents(
  file: string,
  read: NewLines,
  resolver: ProjectResolver,
): { events: KeyedTokenEvent[]; context: string } {
  const context: CodexContext = { model: UNKNOWN_MODEL, cwd: "", repo: null, session: sessionOfFile(file) };
  const track = (entry: any) => {
    const p = entry?.payload;
    if (entry?.type === "session_meta") {
      if (typeof p?.cwd === "string") context.cwd = p.cwd;
      context.repo = repoName(p?.git?.repository_url);
      const id = [p?.id, p?.session_id].find((s) => typeof s === "string" && s);
      if (id) context.session = id;
    }
    if (entry?.type === "turn_context") {
      if (typeof p?.cwd === "string") context.cwd = p.cwd;
      if (typeof p?.model === "string" && p.model) context.model = p.model;
    }
  };
  // The state the last run saved; without one (progress from before it was kept), the lines it
  // read are read again for it.
  const saved = savedContext(read.context);
  if (saved) Object.assign(context, saved);
  else {
    for (const line of read.earlier()) {
      if (line.includes('"turn_context"') || line.includes('"session_meta"')) track(parse(line));
    }
  }

  const events: KeyedTokenEvent[] = [];
  for (const line of read.lines) {
    const isContext = line.includes('"turn_context"') || line.includes('"session_meta"');
    if (!isContext && !line.includes('"token_count"')) continue;
    const entry = parse(line);
    if (isContext) {
      track(entry);
      continue;
    }
    const info = entry?.payload?.type === "token_count" ? entry.payload.info : null;
    const last = info?.last_token_usage;
    if (!last || typeof entry.timestamp !== "string") continue;
    const input = count(last.input_tokens);
    const cacheRead = Math.min(count(last.cached_input_tokens), input);
    const cacheWrite = Math.min(count(last.cache_write_input_tokens), input - cacheRead);
    const output = count(last.output_tokens);
    if (input + output === 0) continue;
    const total = info.total_token_usage?.total_tokens;
    events.push({
      key: `codex:${file}:${typeof total === "number" ? total : entry.timestamp}`,
      session: context.session,
      provider: CODEX_PROVIDER,
      at: new Date(entry.timestamp).toISOString(),
      project: resolver.resolve(context.cwd) ?? context.repo,
      model: context.model,
      input: input - cacheRead - cacheWrite,
      cacheWrite,
      cacheRead,
      output,
    });
  }
  return { events, context: JSON.stringify(context) };
}

/** The model, cwd and repository of the latest turn, and the session: what a Codex call is attributed to. */
interface CodexContext {
  model: string;
  cwd: string;
  repo: string | null;
  /** The `session_meta` id; until one is read, the id in the file name; null without either. */
  session: string | null;
}

/** State saved before sessions were kept (no `session` key) is not used: the earlier lines are read again. */
function savedContext(json: string | null): CodexContext | null {
  const value = json === null ? null : parse(json);
  if (!value || typeof value.model !== "string" || typeof value.cwd !== "string" || !("session" in value)) return null;
  return {
    model: value.model,
    cwd: value.cwd,
    repo: typeof value.repo === "string" ? value.repo : null,
    session: typeof value.session === "string" ? value.session : null,
  };
}

/** `rollout-2026-10-08T12-00-00-<uuid>.jsonl` -> `<uuid>`; null when the name holds none. */
function sessionOfFile(file: string): string | null {
  return /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(file)?.[1] ?? null;
}
