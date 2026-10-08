import type { Report } from "./build.ts";

/**
 * Suggestions (GLOSSARY: Suggestion): at most 3 concrete changes to the Setup, written by Claude
 * (`ClaudeSuggestions` in claude-suggestions.ts, wired in src/cli/report.ts). A failed result
 * (`ok: false`) still lets the Report go out, saying "Suggestions unavailable: <reason>".
 * `noSuggestions` leaves the section out (tests, or a Report built without Claude).
 */
/** A Report has at most this many Suggestions (spec §6). */
export const MAX_SUGGESTIONS = 3;
/** The length Claude is asked for: room under MAX_SUGGESTION_CHARS, since it overshoots. */
export const SUGGESTION_TARGET_CHARS = 100;
/**
 * A Suggestion is at most this long, in the Markdown and the Telegram card alike. A longer one is
 * sent back once to be rewritten, then dropped: never cut, so no Suggestion ends mid-sentence.
 * Lives here (no runtime imports) so the card can use it without an import cycle.
 */
export const MAX_SUGGESTION_CHARS = 140;

export type Suggestions =({ ok: true; items: string[] } | { ok: false; reason: string }) & {
  /** The Setup file is still a DRAFT (its first line says so): the Report says it. */
  draftSetup?: boolean;
};

export interface SuggestionsProvider {
  /** Must not throw for an API failure: return `{ ok: false, reason }` instead. */
  suggest(report: Report): Promise<Suggestions | null>;
}

/** No Suggestions yet (null: the section is left out). */
export const noSuggestions: SuggestionsProvider = {
  suggest: async () => null,
};
