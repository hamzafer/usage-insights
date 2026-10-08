import type { Report } from "./build.ts";

/**
 * Suggestions (GLOSSARY: Suggestion): at most 3 concrete changes to the Setup, written by Claude
 * (`ClaudeSuggestions` in claude-suggestions.ts, wired in src/cli/report.ts). A failed result
 * (`ok: false`) still lets the Report go out, saying "Suggestions unavailable: <reason>".
 * `noSuggestions` leaves the section out (tests, or a Report built without Claude).
 */
export type Suggestions = ({ ok: true; items: string[] } | { ok: false; reason: string }) & {
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
