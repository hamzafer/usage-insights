import type { Pace } from "../pace.ts";
import { formatTokens } from "../summary.ts";
import type { Share } from "../token-shares.ts";
import type { Waste } from "../window-model.ts";
import { type Report, TREND_WEEKS, type WeekTrend } from "./build.ts";
import type { Suggestions } from "./suggestions.ts";

/**
 * The Report as Markdown (saved in the data directory) and as a short plain-text Telegram message.
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
    out.push("", "## Suggestions", "", ...suggestionLines(options.suggestions));
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
      out.push(`| ${c.provider} | ${c.label} | ${at(c.resetAt)} | ${wasteText(c.waste, c.resetAt)} |`);
    }
  }

  out.push("", "### Pace of running Cycles", "");
  if (report.pace.length === 0) out.push("No running Cycles.");
  else {
    out.push("| Provider | Cycle | Reset | Pace |", "|---|---|---|---|");
    for (const p of report.pace) {
      out.push(`| ${p.provider} | ${p.label} | ${p.resetsAt ? at(p.resetsAt) : "unknown"} | ${paceText(p, at)} |`);
    }
  }

  out.push("", "### Limit Hits and Blocked Time", "");
  if (report.limitHits.length === 0) out.push("No Limit Hits this week.");
  else {
    out.push("| Provider | Window | Hit | Blocked this week | Until |", "|---|---|---|---|---|");
    for (const h of report.limitHits) {
      const until = h.blockedUntil ? `${at(h.blockedUntil)} (${h.endedBy === "reset" ? "Reset" : "Overage"})` : "still blocked";
      out.push(`| ${h.provider} | ${h.label} | ${at(h.hitAt)} | ${duration(h.blockedInWeekMs)} | ${until} |`);
    }
  }

  out.push("", "### Overage", "");
  if (report.overage.length === 0) out.push("No Overage readings this week.");
  else for (const o of report.overage) out.push(`- ${o.provider} ${o.label}: ${amount(o.spent, o.unit)}`);

  out.push("", "### Top Projects and models (share of tokens, all Providers)", "");
  if (report.top.total === 0) out.push("No token data this week.");
  else {
    out.push(`Tokens: ${formatTokens(report.top.total)}`, "");
    out.push(`- Projects: ${shares(report.top.byProject)}`, `- Models: ${shares(report.top.byModel)}`);
  }

  out.push("", `### Trend vs the previous ${TREND_WEEKS} weeks`, "");
  out.push(...trendLines(report).map((l) => `- ${l}`));

  out.push("", "### Data coverage", "");
  if (report.coverage.providers.length === 0) out.push("No readings at all.");
  for (const c of report.coverage.providers) {
    out.push(`- ${c.provider}: ${c.readings} readings this week, unknown (no readings) ${duration(c.unknownMs)}`);
  }
  out.push(`- Recorder gaps this week: ${report.coverage.recorderGaps}`);
  return out.join("\n");
}

/** Headline numbers in plain text (no parse mode, so nothing needs escaping). */
export function renderTelegram(report: Report, options: RenderOptions = {}): string {
  const at = timeFormat(options.timeZone);
  const out = [`Usage Insights Report`, title(report, options), ""];

  if (report.cycleWaste.length === 0) out.push("No Cycle reset this week.");
  else {
    out.push("Waste (Cycles reset this week)");
    for (const c of report.cycleWaste) out.push(`- ${c.provider} ${c.label}: ${wasteText(c.waste, c.resetAt)}`);
  }
  if (report.pace.length) {
    out.push("Pace (running Cycles)");
    for (const p of report.pace) out.push(`- ${p.provider} ${p.label}: ${paceText(p, at)}`);
  }

  const blocked = report.limitHits.reduce((sum, h) => sum + h.blockedInWeekMs, 0);
  out.push(
    "",
    report.limitHits.length
      ? `Limit Hits: ${report.limitHits.length}, Blocked Time ${duration(blocked)}`
      : "Limit Hits: none",
  );
  if (report.overage.length) {
    out.push(`Overage: ${report.overage.map((o) => `${o.provider} ${amount(o.spent, o.unit)}`).join(", ")}`);
  }
  if (report.top.total === 0) out.push("No token data this week.");
  else {
    out.push(`Top Projects: ${shares(report.top.byProject.slice(0, 3))}`);
    out.push(`Top models: ${shares(report.top.byModel.slice(0, 3))}`);
  }

  out.push("", `Trend vs previous ${TREND_WEEKS} weeks`, ...trendLines(report).map((l) => `- ${l}`));

  const unknown = report.coverage.providers.filter((c) => c.unknownMs > 0);
  if (unknown.length || report.coverage.recorderGaps) {
    const parts = unknown.map((c) => `${c.provider} ${duration(c.unknownMs)}`);
    if (report.coverage.recorderGaps) parts.push(`${report.coverage.recorderGaps} recorder gaps`);
    out.push("", `Unknown time (no readings): ${parts.join(", ")}`);
  }
  if (report.dataNotes.length) out.push("", "Data notes", ...report.dataNotes.map((n) => `- ${n}`));
  if (options.suggestions) out.push("", "Suggestions", ...suggestionLines(options.suggestions));
  if (options.reportFile) out.push("", `Full Report: ${options.reportFile} in the data directory`);
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
    return `Waste ${w.provider} ${w.label}: ${now} (before: ${before})`;
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

function suggestionLines(s: Suggestions): string[] {
  if (!s.ok) return [`Suggestions could not be written: ${s.reason}`];
  if (s.items.length === 0) return ["No Suggestions this week."];
  return s.items.map((item, i) => `${i + 1}. ${item}`);
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

/** Overage keeps its own unit: dollars or credits, never a share of the allowance. */
function amount(value: number, unit: string): string {
  return unit === "$" ? `$${value.toFixed(2)}` : `${Math.round(value * 100) / 100} ${unit}`;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function duration(durationMs: number): string {
  const minutes = Math.round(durationMs / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return [days && `${days}d`, hours && `${hours}h`, mins && `${mins}m`].filter(Boolean).join(" ") || "0m";
}

function timeFormat(timeZone: string | undefined): (iso: string) => string {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return (iso) => f.format(new Date(iso));
}

function dayFormat(timeZone: string | undefined): (iso: string) => string {
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (iso) => f.format(new Date(iso));
}
