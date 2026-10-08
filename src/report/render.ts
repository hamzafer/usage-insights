import { modelName, providerName } from "../names.ts";
import type { Pace } from "../pace.ts";
import { formatTokens } from "../summary.ts";
import type { Share } from "../token-shares.ts";
import type { Waste } from "../window-model.ts";
import { type CycleWaste, type Report, TREND_WEEKS, type WeekTrend } from "./build.ts";
import { amount, dayFormat, duration, percent, timeFormat } from "./format.ts";
import type { Suggestions } from "./suggestions.ts";

export { renderTelegram } from "./card.ts";

/**
 * The Report as Markdown (saved in the data directory, full detail); the Telegram card is in card.ts.
 * Estimated figures are marked "~" (GLOSSARY: Measured vs Estimated); missing data is said, not zeroed.
 */

export interface RenderOptions {
  /** IANA time zone for times; the machine's local zone when omitted. */
  timeZone?: string;
  /** Where the full Report is saved, relative to the data directory (named in the message). */
  reportFile?: string;
  /** The local dashboard's address, linked from the Markdown. */
  dashboardUrl?: string;
  /** Null or omitted: no Suggestions section (see suggestions.ts). */
  suggestions?: Suggestions | null;
}

export function renderMarkdown(report: Report, options: RenderOptions = {}): string {
  const out = [`# Usage Insights Report: ${title(report, options)}`, "", renderNumbers(report, options)];
  if (options.suggestions) {
    out.push("", "## Suggestions", "", ...suggestionLines(options.suggestions, true));
  }
  out.push("", "## Data notes", "");
  if (report.dataNotes.length) out.push(...report.dataNotes.map((n) => `- ${n}`));
  else out.push("- All Backfills ran.");
  if (options.dashboardUrl) out.push("", `Dashboard: ${options.dashboardUrl}`);
  return `${out.join("\n")}\n`;
}

/** The numbers section: computed without Claude, so it is always there. */
export function renderNumbers(report: Report, options: RenderOptions = {}): string {
  const at = timeFormat(options.timeZone);
  const out = ["## Numbers", "", `Week: ${at(report.from)} to ${at(report.to)}`, ""];

  out.push("### Waste of Cycles that reset this week", "");
  if (report.cycleWaste.length === 0) out.push("No Cycle reset this week.");
  else {
    out.push("| Provider | Cycle | Reset | Waste |", "|---|---|---|---|");
    for (const c of report.cycleWaste) {
      out.push(`| ${providerName(c.provider)} | ${c.label} | ${at(c.resetAt)} | ${cycleWasteText(c)} |`);
    }
  }

  out.push("", "### Pace of running Cycles", "");
  if (report.pace.length === 0) out.push("No running Cycles.");
  else {
    out.push("| Provider | Cycle | Reset | Pace |", "|---|---|---|---|");
    for (const p of report.pace) {
      out.push(`| ${providerName(p.provider)} | ${p.label} | ${p.resetsAt ? at(p.resetsAt) : "unknown"} | ${paceText(p, at)} |`);
    }
  }

  out.push("", "### Limit Hits and Blocked Time", "");
  if (report.limitHits.length === 0) out.push("No Limit Hits this week.");
  else {
    out.push("| Provider | Window | Hit | Blocked this week | Until |", "|---|---|---|---|---|");
    for (const h of report.limitHits) {
      const until = h.blockedUntil ? `${at(h.blockedUntil)} (${h.endedBy === "reset" ? "Reset" : "Overage"})` : "still blocked";
      out.push(`| ${providerName(h.provider)} | ${h.label} | ${at(h.hitAt)} | ${duration(h.blockedInWeekMs)} | ${until} |`);
    }
  }

  out.push("", "### Overage", "");
  if (report.overage.length === 0) out.push("No Overage readings this week.");
  else for (const o of report.overage) out.push(`- ${providerName(o.provider)} ${o.label}: ${amount(o.spent, o.unit)}`);

  out.push("", "### Top Projects and models (share of tokens, all Providers)", "");
  if (report.top.total === 0) out.push("No token data this week.");
  else {
    out.push(`Tokens: ${formatTokens(report.top.total)}`, "");
    out.push(`- Projects: ${shares(report.top.byProject)}`, `- Models: ${shares(report.top.byModel.map((m) => ({ ...m, name: modelName(m.name) })))}`);
  }

  out.push("", `### Trend vs the previous ${TREND_WEEKS} weeks`, "");
  out.push(...trendLines(report).map((l) => `- ${l}`));

  out.push("", "### Data coverage", "");
  if (report.coverage.providers.length === 0) out.push("No readings at all.");
  for (const c of report.coverage.providers) {
    out.push(`- ${providerName(c.provider)}: ${c.readings} readings this week, unknown (no readings) ${duration(c.unknownMs)}`);
  }
  out.push(`- Recorder gaps this week: ${report.coverage.recorderGaps}`);
  return out.join("\n");
}

function title(report: Report, options: RenderOptions): string {
  const day = dayFormat(options.timeZone);
  return `${day(report.from)} to ${day(report.to)}`;
}

function trendLines(report: Report): string[] {
  const lines = report.trend.waste.map((w) => {
    const marker = w.basis === "estimated" ? "~" : "";
    const now = w.thisWeek === null ? "none reset" : `${marker}${percent(w.thisWeek)}`;
    const before =
      w.previous === null ? "no earlier Cycles" : `${marker}${percent(w.previous)} over ${w.previousCycles} Cycles`;
    return `Waste ${providerName(w.provider)} ${w.label}: ${now} (before: ${before})`;
  });
  lines.push(trendLine("Limit Hits", report.trend.limitHits, (n) => String(Math.round(n * 10) / 10)));
  lines.push(trendLine("Blocked Time", report.trend.blockedMs, duration));
  lines.push(trendLine("Tokens", report.trend.tokens, formatTokens));
  return lines;
}

function trendLine(name: string, t: WeekTrend, format: (n: number) => string): string {
  const before = t.previousAvg === null ? "no earlier data" : `avg ${format(t.previousAvg)} over ${t.previousWeeks} weeks`;
  return `${name}: ${format(t.thisWeek)} (before: ${before})`;
}

function suggestionLines(s: Suggestions, markdown = false): string[] {
  const draft = s.draftSetup ? [DRAFT_NOTE, ...(markdown ? [""] : [])] : [];
  if (!s.ok) return [...draft, `Suggestions unavailable: ${s.reason}`];
  if (s.items.length === 0) return [...draft, "No Suggestions this week."];
  return [...draft, ...s.items.map((item, i) => `${i + 1}. ${item}`)];
}

const DRAFT_NOTE = "Setup is a DRAFT: check setup.md in the data directory and remove DRAFT from its first line.";

function cycleWasteText(c: CycleWaste): string {
  const text = wasteText(c.waste, c.resetAt);
  return c.inferred ? `${text} (dates inferred)` : text;
}

function wasteText(waste: Waste | null, resetAt: string): string {
  if (!waste) return "n/a";
  const marker = waste.basis === "estimated" ? "~" : "";
  const low = waste.lowConfidence ? ` (low confidence: last reading ${duration(Date.parse(resetAt) - Date.parse(waste.lastReadingAt))} before Reset)` : "";
  return `${marker}${percent(waste.share)}${low}`;
}

function paceText(p: Pace, at: (iso: string) => string): string {
  if (p.expectedWaste === null) return "n/a (needs two readings)";
  const marker = p.basis === "estimated" ? "~" : "";
  const waste = `heading for Waste ${marker}${percent(p.expectedWaste)}`;
  return p.projectedLimitHitAt ? `${waste}, limit at ${at(p.projectedLimitHitAt)}` : waste;
}

function shares(list: readonly Share[]): string {
  return list.map((s) => `${s.name} ${percent(s.share)}`).join(", ");
}
