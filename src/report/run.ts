import { type Backfill, backfillJob } from "../backfill/jobs.ts";
import type { RunOutcome } from "../store.ts";
import { buildReport, type ReportInput } from "./build.ts";
import { escapeHtml } from "./format.ts";
import { renderMarkdown, renderTelegram } from "./render.ts";
import { noSuggestions, type Suggestions, type SuggestionsProvider } from "./suggestions.ts";
import type { Messenger } from "./telegram.ts";

/**
 * One Report run (`bun run report`, spec §6): refresh data with the incremental Backfills, build
 * the Report for the 7 days before now, save the full Markdown and send the compact card (HTML). If
 * anything before sending fails (setup, loading, building), a short "Usage Insights Report failed:
 * <reason>" message goes out instead. Each Backfill's and the Report's outcome is recorded, so the
 * dashboard's data-health page shows failures (spec: Error handling).
 */

export type { Backfill };

export interface ReportDeps {
  now: () => Date;
  /**
   * Runs first: configuration, data directory, store. When it throws, the failure message goes out
   * and nothing else runs (no Backfill, no Report).
   */
  prepare?: () => void;
  /** Run first, in order; a failure is logged and noted in the Report, and the run goes on. Skipped on a dry run. */
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
  /** Records each Backfill's and the Report's outcome (never on a dry run). A failure here is only logged. */
  recordRun?: (outcome: RunOutcome) => void;
  /** Claude-written Suggestions; none (no section) when omitted. */
  suggestions?: SuggestionsProvider;
  timeZone?: string;
  dashboardUrl?: string;
  /** Print the message and the Report; run no Backfill, and send, save and record nothing. */
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

export const REPORT_JOB = "report";

export async function runReport(deps: ReportDeps): Promise<ReportRunResult> {
  const prefix = deps.test ? "[TEST] " : "";
  const record = (job: string, error: unknown | null) => {
    if (deps.dryRun || !deps.recordRun) return;
    try {
      deps.recordRun({ job, at: deps.now().toISOString(), ok: error === null, reason: error === null ? null : reason(error) });
    } catch (e) {
      deps.log(`Could not record the ${job} outcome: ${reason(e)}`);
    }
  };

  let message: string;
  let markdown: string | null = null;
  let file: string | null = null;
  let failure: unknown | null = null;
  try {
    deps.prepare?.();

    const notes: string[] = [];
    for (const b of deps.dryRun ? [] : deps.backfills) {
      const job = backfillJob(b);
      try {
        await b.run();
        record(job, null);
      } catch (e) {
        const note = `${b.name} Backfill failed: ${reason(e)}`;
        notes.push(note);
        deps.log(note);
        record(job, e);
      }
    }

    const now = deps.now();
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
    markdown = null;
    failure = e;
    deps.log(`Report failed: ${reason(e)}`);
    message = `${prefix}Usage Insights Report failed: ${escapeHtml(reason(e))}`;
  }

  if (deps.dryRun) {
    deps.print(message);
    if (markdown) deps.print(`\n--- Full Report (dry run: not saved) ---\n\n${markdown}`);
  } else {
    try {
      await deps.messenger.send(message);
    } catch (e) {
      record(REPORT_JOB, e);
      throw e;
    }
    deps.log(file ? `Report sent; saved ${file}` : "Failure message sent");
  }
  record(REPORT_JOB, failure);
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
