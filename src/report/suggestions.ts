import type { Report } from "./build.ts";

/**
 * EXTENSION POINT (ticket #10): Suggestions (GLOSSARY: Suggestion).
 *
 * Ticket #10 adds a provider that sends the Report's numbers plus `setup.md` to Claude and asks for
 * at most 3 concrete Suggestions referencing the Setup (spec §6). Implement `SuggestionsProvider`
 * and pass it to `runReport` (src/report/run.ts) from the CLI (src/cli/report.ts). Nothing else
 * changes: the renderers already show `Suggestions` in the Markdown and the Telegram message, and
 * a failed result (`ok: false`) still lets the Report go out, saying why there are none.
 *
 * Until then `noSuggestions` is used and the Report has no Suggestions section.
 */
export type Suggestions = { ok: true; items: string[] } | { ok: false; reason: string };

export interface SuggestionsProvider {
  /** Must not throw for an API failure: return `{ ok: false, reason }` instead. */
  suggest(report: Report): Promise<Suggestions | null>;
}

/** No Suggestions yet (null: the section is left out). */
export const noSuggestions: SuggestionsProvider = {
  suggest: async () => null,
};
