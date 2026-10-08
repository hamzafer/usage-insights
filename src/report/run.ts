import { buildReport, type ReportInput } from "./build.ts";
import { renderMarkdown, renderTelegram } from "./render.ts";
import { noSuggestions, type Suggestions, type SuggestionsProvider } from "./suggestions.ts";
import type { Messenger } from "./telegram.ts";

/**
 * One Report run (`bun run report`, spec §6): refresh data with the incremental Backfills, build
 * the Report for the 7 days before now, save the full Markdown and send the short message. If
 * building fails, a short "Usage Insights Report failed: <reason>" message goes out instead.
 */

export interface Backfill {
  name: string;
  run: () => void | Promise<void>;
}

export interface ReportDeps {
  now: () => Date;
  /** Run first, in order; a failure is logged and noted in the Report, and the run goes on. */
  backfills: readonly Backfill[];
  /** Reads the stored data (after the Backfills). */
  load: () => Omit<ReportInput, "now" | "dataNotes">;
  messenger: Messenger;
  /** Writes the Markdown to `file`, a path relative to the data directory. */
  save: (file: string, markdown: string) => void;
  /** Dry-run output. */
  print: (text: string) => void;
  /** Progress and problems (the launchd log). Never given secrets. */
  log: (line: string) => void;
  /** Claude-written Suggestions; none (no section) when omitted. */
  suggestions?: SuggestionsProvider;
  timeZone?: string;
  dashboardUrl?: string;
  /** Print the message and the Report; send and save nothing. */
  dryRun?: boolean;
  /** Prefix the message with "[TEST] ". */
  test?: boolean;
}

export interface ReportRunResult {
  /** False when building the Report failed (the failure message was sent instead). */
  ok: boolean;
  message: string;
  /** The saved Report, relative to the data directory; null when nothing was saved. */
  file: string | null;
}

export async function runReport(deps: ReportDeps): Promise<ReportRunResult> {
  const notes: string[] = [];
  for (const b of deps.backfills) {
    try {
      await b.run();
    } catch (e) {
      const note = `${b.name} Backfill failed: ${reason(e)}`;
      notes.push(note);
      deps.log(note);
    }
  }

  const now = deps.now();
  const prefix = deps.test ? "[TEST] " : "";
  let message: string;
  let markdown: string | null = null;
  let file: string | null = null;
  try {
    const report = buildReport({ ...deps.load(), now: now.toISOString(), dataNotes: notes });
    const suggestions = await suggest(deps.suggestions ?? noSuggestions, report);
    const reportFile = `reports/${localDate(now, deps.timeZone)}.md`;
    const options = { timeZone: deps.timeZone, dashboardUrl: deps.dashboardUrl, suggestions, reportFile };
    markdown = renderMarkdown(report, options);
    message = prefix + renderTelegram(report, deps.dryRun ? { ...options, reportFile: undefined } : options);
    if (!deps.dryRun) {
      deps.save(reportFile, markdown);
      file = reportFile;
    }
  } catch (e) {
    deps.log(`Report failed: ${reason(e)}`);
    message = `${prefix}Usage Insights Report failed: ${reason(e)}`;
  }

  if (deps.dryRun) {
    deps.print(message);
    if (markdown) deps.print(`\n--- Full Report (dry run: not saved) ---\n\n${markdown}`);
  } else {
    await deps.messenger.send(message);
    deps.log(file ? `Report sent; saved ${file}` : "Failure message sent");
  }
  return { ok: markdown !== null, message, file };
}

async function suggest(provider: SuggestionsProvider, report: Parameters<SuggestionsProvider["suggest"]>[0]): Promise<Suggestions | null> {
  try {
    return await provider.suggest(report);
  } catch (e) {
    return { ok: false, reason: reason(e) };
  }
}

/** YYYY-MM-DD in the given (else the machine's) time zone. */
function localDate(at: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
