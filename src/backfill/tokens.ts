import { Glob } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createProjectResolver, type ProjectResolver } from "../projects.ts";
import type { KeyedTokenEvent, Store } from "../store.ts";

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
      add(readNewLines(store, `tokens:${source.provider}`, source.dir, file, (lines) =>
        lines.flatMap((line) => claudeEvent(line, source.provider, resolver)),
      ));
    }
  }
  for (const file of logFiles(codexDir, "**/rollout-*.jsonl")) {
    add(readNewLines(store, `tokens:${CODEX_PROVIDER}`, codexDir, file, (lines, before) => codexEvents(file, lines, before(), resolver)));
  }
  return result;
}

function logFiles(dir: string, pattern: string): string[] {
  if (!existsSync(dir)) return [];
  return [...new Glob(pattern).scanSync({ cwd: dir, onlyFiles: true })].toSorted();
}

const NEWLINE = 0x0a;

/**
 * Hands the complete lines appended since the last run to `parse` and stores its events. A line
 * still being written is left for the next run; a file that shrank is read again from the start.
 * `before()` gives the lines already read, for parsers that need earlier context.
 */
function readNewLines(
  store: Store,
  source: string,
  dir: string,
  relative: string,
  parse: (lines: string[], before: () => string[]) => KeyedTokenEvent[],
): { linesRead: number; stored: number } {
  const bytes = readFileSync(join(dir, relative));
  let offset = store.backfillOffset(source, relative);
  if (offset > bytes.length) offset = 0;
  const end = bytes.lastIndexOf(NEWLINE) + 1;
  if (end <= offset) return { linesRead: 0, stored: 0 };

  const lines = bytes.subarray(offset, end).toString("utf8").split("\n").slice(0, -1);
  const before = () => (offset ? bytes.subarray(0, offset).toString("utf8").split("\n") : []);
  const stored = store.saveTokenEvents(parse(lines, before));
  store.saveBackfillOffset(source, relative, end);
  return { linesRead: lines.length, stored };
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
  return [
    {
      key: `claude:${message.id}:${requestId}`,
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
function codexEvents(file: string, lines: string[], earlier: string[], resolver: ProjectResolver): KeyedTokenEvent[] {
  const context = { model: UNKNOWN_MODEL, cwd: "", repo: null as string | null };
  const track = (entry: any) => {
    const p = entry?.payload;
    if (entry?.type === "session_meta") {
      if (typeof p?.cwd === "string") context.cwd = p.cwd;
      context.repo = repoName(p?.git?.repository_url);
    }
    if (entry?.type === "turn_context") {
      if (typeof p?.cwd === "string") context.cwd = p.cwd;
      if (typeof p?.model === "string" && p.model) context.model = p.model;
    }
  };
  for (const line of earlier) {
    if (line.includes('"turn_context"') || line.includes('"session_meta"')) track(parse(line));
  }

  const events: KeyedTokenEvent[] = [];
  for (const line of lines) {
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
  return events;
}
