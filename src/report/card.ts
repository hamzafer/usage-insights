import { modelName, providerName } from "../names.ts";
import type { Pace } from "../pace.ts";
import { formatTokens } from "../summary.ts";
import type { Share } from "../token-shares.ts";
import { type Report, WEEK_MS, type WeekOverage } from "./build.ts";
import { clip, duration, escapeHtml as e, percent } from "./format.ts";
import { MAX_SUGGESTION_CHARS, type Suggestions } from "./suggestions.ts";
import { fitTelegram, TELEGRAM_TEXT_LIMIT } from "./telegram.ts";
import { dateParts } from "../dates.ts";
import { paceStatus, type Status } from "../pace-status.ts";

// The status rule is shared with the dashboard (src/pace-status.ts).
export { BLOCKED_GREEN, BLOCKED_RED, paceStatus, type Status, WASTE_GREEN, WASTE_RED } from "../pace-status.ts";

/**
 * The Report as a compact Telegram card (Bot API `parse_mode: "HTML"`): readable in 5 seconds,
 * full detail stays in the Markdown Report. Every piece of dynamic text is escaped.
 *
 *   📊 Usage week · 5–12 Oct
 *   ▶ Running now       one line per running Cycle, a status dot each, worst first
 *   ✅ Last week        Cycles that reset, Limit Hits and Overage
 *   💡 Suggestions      numbered, each at most 120 characters (cut on a word boundary when parsed)
 *   ▸ Details           expandable blockquote: top Projects and models, tokens, coverage
 */

export interface CardOptions {
  timeZone?: string;
  /** Where the full Report is saved, relative to the data directory. */
  reportFile?: string;
  suggestions?: Suggestions | null;
}

/**
 * Data notes longer than this are cut in the card. Suggestions arrive already within
 * MAX_SUGGESTION_CHARS (the same length), so for them this is only a safety net.
 */
export const SUGGESTION_CHARS = MAX_SUGGESTION_CHARS;
/** Data notes shown in the card; the rest are counted. */
const MAX_NOTES = 3;
/** While recording is younger than this, the card says "Week N of recording" instead of listing unknown time. */
const YOUNG_RECORDING_MS = 4 * WEEK_MS;

const DOTS: Record<Status, string> = { red: "🔴", yellow: "🟡", green: "🟢", unknown: "⚪" };
const RANK: Record<Status, number> = { red: 0, yellow: 1, green: 2, unknown: 3 };

export function renderTelegram(report: Report, options: CardOptions = {}): string {
  const full = card(report, options, true);
  if (full.length <= TELEGRAM_TEXT_LIMIT) return full;
  return fitTelegram(card(report, options, false));
}

function card(report: Report, options: CardOptions, withDetails: boolean): string {
  const out = [`<b>📊 Usage week · ${e(weekRange(report, options.timeZone))}</b>`, ""];
  out.push("<b>▶ Running now</b>", ...runningNow(report, options.timeZone), "");
  out.push("<b>✅ Last week</b>", ...lastWeek(report), ...dataNotes(report));
  if (options.suggestions) out.push("", ...suggestionLines(options.suggestions));
  if (withDetails) {
    out.push("", "<b>▸ Details</b>", `<blockquote expandable>${details(report, options).join("\n")}</blockquote>`);
  }
  return out.join("\n");
}

function runningNow(report: Report, timeZone: string | undefined): string[] {
  if (report.pace.length === 0) return ["No running Cycles."];
  const labelsPer = Map.groupBy(report.pace, (p) => p.provider);
  const rows = report.pace
    .map((p) => {
      const name = labelsPer.get(p.provider)!.length > 1 ? `${providerName(p.provider)} ${p.label}` : providerName(p.provider);
      return { name, ...paceStatus(p), text: paceText(p, report.to, timeZone) };
    })
    .toSorted((a, b) => RANK[a.status] - RANK[b.status] || b.score - a.score || compare(a.name, b.name));
  const width = Math.max(...rows.map((r) => [...r.name].length)) + 2;
  return rows.map((r) => `${DOTS[r.status]} ${e(r.name.padEnd(width))}${e(r.text)}`);
}

function paceText(p: Pace, now: string, timeZone: string | undefined): string {
  const { status } = paceStatus(p);
  if (p.usedShare === 0) return p.resetsAt ? `untouched · resets ${dayMonth(p.resetsAt, timeZone)}` : "untouched";
  if (p.projectedLimitHitAt) return `on pace to max out ${when(p.projectedLimitHitAt, now, timeZone)}`;
  if (p.expectedWaste === null) return "needs more readings";
  if (status === "green") return "on track";
  const marker = "~";
  return `${percent(p.usedShare)} used · ${marker}${percent(p.expectedWaste)} waste ahead`;
}

function lastWeek(report: Report): string[] {
  const lines: string[] = [];
  const reset = report.trend.waste.filter((w) => w.thisWeek !== null);
  const multiLabel = (provider: string) => new Set(report.cycleWaste.filter((c) => c.provider === provider).map((c) => c.label)).size > 1;
  const nameOf = (provider: string, label: string) => (multiLabel(provider) ? `${providerName(provider)} ${label}` : providerName(provider));
  for (const w of reset) {
    const count = report.cycleWaste.filter((c) => c.provider === w.provider && c.label === w.label && c.waste?.basis === w.basis).length;
    const marker = w.basis === "estimated" ? "~" : "";
    let line = `${nameOf(w.provider, w.label)} reset ${count}× · ${marker}${percent(w.thisWeek!)} wasted`;
    if (w.previous !== null) {
      const now = Math.round(w.thisWeek! * 100);
      const before = Math.round(w.previous * 100);
      line += now === before ? " (same as before)" : ` (${now > before ? "↑" : "↓"} from ${marker}${before}%)`;
    }
    lines.push(e(line));
  }
  const measured = new Set(reset.map((w) => `${w.provider}\u0000${w.label}`));
  const unmeasured = Map.groupBy(
    report.cycleWaste.filter((c) => !c.waste && !measured.has(`${c.provider}\u0000${c.label}`)),
    (c) => nameOf(c.provider, c.label),
  );
  for (const [name, cycles] of unmeasured) lines.push(e(`${name} reset ${cycles.length}× · Waste n/a`));
  if (lines.length === 0) lines.push("No Cycle reset this week.");

  const hits = report.trend.limitHits;
  let limit = `🚫 Limit hits: ${hits.thisWeek}`;
  if (hits.previousAvg !== null) limit += ` (was ${Math.round(hits.previousAvg * 10) / 10}/wk)`;
  if (hits.thisWeek > 0) limit += ` · blocked ${duration(report.trend.blockedMs.thisWeek)}`;
  lines.push(`${limit}   💸 Overage: ${e(overageTotal(report.overage))}`);
  return lines;
}

function overageTotal(overage: readonly WeekOverage[]): string {
  if (overage.length === 0) return "none";
  const totals = [...Map.groupBy(overage, (o) => o.unit)].map(([unit, lines]) => ({
    unit,
    sum: lines.reduce((s, o) => s + o.spent, 0),
  }));
  const spent = totals.filter((t) => t.sum > 0);
  const show = spent.length ? spent : [totals.find((t) => t.unit === "$") ?? totals[0]!];
  return show
    .map(({ unit, sum }) => {
      const n = Number.isInteger(sum) ? String(sum) : sum.toFixed(2);
      return unit === "$" ? `$${n}` : `${Number(n)} ${unit}`;
    })
    .join(" + ");
}

function dataNotes(report: Report): string[] {
  const shown = report.dataNotes.slice(0, MAX_NOTES).map((n) => `⚠️ ${e(clip(n, SUGGESTION_CHARS))}`);
  const more = report.dataNotes.length - shown.length;
  return more > 0 ? [...shown, `⚠️ +${more} more data notes in the full Report`] : shown;
}

function suggestionLines(s: Suggestions): string[] {
  const draft = s.draftSetup ? ["<i>Setup is a DRAFT: edit setup.md</i>"] : [];
  if (!s.ok) return [`💡 <i>Suggestions unavailable: ${e(clip(s.reason, 80))}</i>`, ...draft];
  if (s.items.length === 0) return ["💡 No Suggestions this week.", ...draft];
  return ["<b>💡 Suggestions</b>", ...draft, ...s.items.map((item, i) => `${i + 1}. ${e(clip(item, SUGGESTION_CHARS))}`)];
}

function details(report: Report, options: CardOptions): string[] {
  const out: string[] = [];
  const top = report.top;
  if (top.total === 0) out.push("🏆 No token data this week.");
  else {
    const models = top.byModel.map((m) => ({ ...m, name: modelName(m.name) }));
    out.push(`🏆 ${e(shares(top.byProject.slice(0, 2)))} · ${e(shares(models.slice(0, 2)))}`);
    out.push(`📈 Tokens ${formatTokens(top.total)} (${tokenTrend(report.trend.tokens.thisWeek, report.trend.tokens.previousAvg)})`);
  }

  const since = report.coverage.recordingSince;
  const age = since ? Date.parse(report.to) - Date.parse(since) : null;
  if (age !== null && age < YOUNG_RECORDING_MS) {
    out.push(`⏳ Week ${Math.floor(age / WEEK_MS) + 1} of recording: numbers sharpen`);
  } else {
    const parts = report.coverage.providers
      .filter((c) => c.unknownMs > 0)
      .map((c) => `${providerName(c.provider)} ${duration(c.unknownMs)}`);
    const gaps = report.coverage.recorderGaps;
    if (parts.length || gaps) {
      const gapText = gaps ? `${gaps} recorder gap${gaps === 1 ? "" : "s"}` : "";
      out.push(`⏳ Unknown time: ${e([parts.join(", "), gapText].filter(Boolean).join(" · "))}`);
    }
  }
  if (options.reportFile) out.push(`📄 Full Report: ${e(options.reportFile)}`);
  return out;
}

function tokenTrend(thisWeek: number, previousAvg: number | null): string {
  if (previousAvg === null) return "first week";
  if (previousAvg === 0) return thisWeek ? "none before" : "same as usual";
  const r = thisWeek / previousAvg;
  if (r >= 2) return `↑ ${Number(r.toFixed(1))}× usual`;
  if (r > 1.15) return `↑ ${percent(r - 1)} vs usual`;
  if (r < 0.85) return `↓ ${percent(1 - r)} vs usual`;
  return "same as usual";
}

function shares(list: readonly Share[]): string {
  return list.map((s) => `${s.name} ${percent(s.share)}`).join(", ");
}

function weekRange(report: Report, timeZone: string | undefined): string {
  const a = dateParts(report.from, timeZone);
  const b = dateParts(report.to, timeZone);
  return a.month === b.month ? `${a.day}–${b.day} ${b.month}` : `${a.day} ${a.month} – ${b.day} ${b.month}`;
}

function dayMonth(iso: string, timeZone: string | undefined): string {
  const p = dateParts(iso, timeZone);
  return `${p.day} ${p.month}`;
}

/** A weekday within the coming week, else a date. */
function when(iso: string, now: string, timeZone: string | undefined): string {
  if (Date.parse(iso) - Date.parse(now) < 6 * 24 * 3_600_000) {
    return dateParts(iso, timeZone).weekday;
  }
  return dayMonth(iso, timeZone);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
