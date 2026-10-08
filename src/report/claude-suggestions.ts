import type { Report } from "./build.ts";
import { renderNumbers } from "./render.ts";
import { isDraftSetup } from "./setup.ts";
import {
  MAX_SUGGESTION_CHARS,
  MAX_SUGGESTIONS,
  SUGGESTION_TARGET_CHARS,
  type Suggestions,
  type SuggestionsProvider,
} from "./suggestions.ts";

export { MAX_SUGGESTION_CHARS, MAX_SUGGESTIONS, SUGGESTION_TARGET_CHARS };

/**
 * Suggestions written by Claude (spec §6, GLOSSARY: Suggestion): the Report's computed numbers plus
 * the user's Setup file go to Claude, which answers with at most 3 concrete changes to the Setup.
 * Only the numbers section is sent: no raw log content, no data notes, and Projects by folder name.
 */

/** A Suggestion about the Setup being a DRAFT or missing prices (the DRAFT line already says it). */
const ABOUT_THE_DRAFT = /\bDRAFT\b|\bfill(?:ing)?\s+(?:in|out)\b/i;

/** Claude behind an interface (a fake in tests). Throws an Error with a safe, key-free message. */
export interface ClaudeClient {
  ask(prompt: { system: string; user: string }): Promise<string>;
}

export interface ClaudeSuggestionsOptions {
  client: ClaudeClient;
  /** The Setup file's text (throws when it cannot be read). */
  readSetup: () => string;
  timeZone?: string;
}

const SYSTEM = [
  "You review how one person uses their AI coding subscriptions (Providers such as Claude, Codex, Cursor, Copilot).",
  "Waste is the share of a Cycle's allowance left unused at its Reset. A Limit Hit is reaching a limit; Blocked Time is the time spent blocked after one.",
  "Pace is the Waste a running Cycle is heading for. Overage is paid usage beyond the allowance. Figures marked ~ are estimated.",
  "You write Suggestions: concrete changes to the person's Setup (which Provider, plan and model does which job), based on the numbers.",
].join(" ");

export class ClaudeSuggestions implements SuggestionsProvider {
  constructor(private readonly options: ClaudeSuggestionsOptions) {}

  async suggest(report: Report): Promise<Suggestions> {
    let setup: string;
    try {
      setup = this.options.readSetup();
    } catch (e) {
      return { ok: false, reason: `Setup file could not be read: ${reason(e)}` };
    }
    const draft = isDraftSetup(setup) ? { draftSetup: true } : {};
    let answer: string;
    try {
      answer = await this.options.client.ask({ system: SYSTEM, user: userPrompt(setup, report, this.options.timeZone) });
    } catch (e) {
      return { ok: false, reason: reason(e), ...draft };
    }
    const parsed = parseSuggestions(answer);
    if (!parsed.ok) return { ...parsed, ...draft };
    return { ok: true, items: await this.withinLimit(parsed.items), ...draft };
  }

  /** Rewrites too-long Suggestions once, in place; drops any still too long or if the rewrite fails. */
  private async withinLimit(items: string[]): Promise<string[]> {
    const long = items.filter((item) => !fits(item));
    if (long.length === 0) return items;
    let rewritten: string[] = [];
    try {
      const answer = await this.options.client.ask({ system: SYSTEM, user: shortenPrompt(long) });
      const parsed = parseSuggestions(answer);
      // Rewrites are matched to the long items by position, so a different count (merged, missing
      // or filtered ones) would put a rewrite in the wrong place: then none are used.
      if (parsed.ok && parsed.items.length === long.length) rewritten = parsed.items;
    } catch {
      // The rewrite is best effort: without it, the long Suggestions are dropped below.
    }
    let next = 0;
    return items
      .map((item) => (fits(item) ? item : rewritten[next++]))
      .filter((item): item is string => item !== undefined && fits(item));
  }
}

function fits(item: string): boolean {
  return [...item].length <= MAX_SUGGESTION_CHARS;
}

function shortenPrompt(long: string[]): string {
  return [
    `Rewrite each of these Suggestions as one sentence of at most ${SUGGESTION_TARGET_CHARS} characters.`,
    "Keep the Provider, the change and the number that motivates it; drop everything else.",
    "<suggestions>",
    ...long.map((item) => `- ${item}`),
    "</suggestions>",
    'Answer with JSON only, in the same order: {"suggestions": ["...", "..."]}',
  ].join("\n");
}

function userPrompt(setup: string, report: Report, timeZone: string | undefined): string {
  return [
    "<setup>",
    setup.trim(),
    "</setup>",
    "",
    "<numbers>",
    renderNumbers(report, { timeZone }),
    "</numbers>",
    "",
    `Write at most ${MAX_SUGGESTIONS} Suggestions for this week. Each one:`,
    "- is a concrete change to the Setup above, naming the Provider, plan or job from the Setup it concerns;",
    "- cites the number from this week's Report that motivates it;",
    `- is one sentence of at most ${SUGGESTION_TARGET_CHARS} characters, plain text, no Markdown.`,
    "Goals the Setup states come first. Fewer Suggestions (or none) is fine when the numbers do not support a change; never invent numbers.",
    "Where a price says unknown, do not guess it.",
    "Never spend a Suggestion on the Setup itself being a DRAFT or on filling in its prices: the Report already says so.",
    'Answer with JSON only: {"suggestions": ["...", "..."]}',
  ].join("\n");
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Reads Claude's answer: JSON `{"suggestions": [...]}` (or a bare array), also when it is wrapped in
 * prose or a code fence. Keeps at most 3 non-empty strings, whole (length is handled by the caller,
 * which never cuts), and drops any that only say the Setup is a DRAFT or needs prices filled in (the
 * Report's DRAFT line says that). Never throws.
 */
export function parseSuggestions(answer: string): Suggestions {
  const value = findJson(answer);
  if (value === undefined) return { ok: false, reason: "Claude's answer was not valid JSON" };
  const list = Array.isArray(value) ? value : isObject(value) ? value.suggestions : undefined;
  if (!Array.isArray(list)) return { ok: false, reason: "Claude's answer had no suggestions list" };
  const items = list
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !ABOUT_THE_DRAFT.test(item))
    .slice(0, MAX_SUGGESTIONS);
  return { ok: true, items };
}

function findJson(text: string): unknown {
  const candidates = [text.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) candidates.push(fence[1].trim());
  for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
