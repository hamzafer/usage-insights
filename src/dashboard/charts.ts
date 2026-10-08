import type { Waste } from "../window-model.ts";
import { escapeHtml, formatShare, formatTime, type FormatOptions } from "./format.ts";
import type { CycleResult, IdleEntry, Span } from "./view-model.ts";

/**
 * Inline SVG charts, no runtime dependencies. X positions are percentages so a chart fills its
 * container at any width while text keeps its pixel size; y positions are pixels. Every mark is
 * focusable and carries a `data-tip` the page script shows on hover and focus, plus a <title>.
 * Rules (dataviz): one y-scale, thin marks with 4px rounded data-ends, hairline solid grid,
 * text in ink tokens, colors by fixed series slot, Estimated hatched and marked "~", gaps hatched
 * and never drawn as zero.
 */

const PLOT_TOP = 16;
const AXIS_BAND = 22;
const MAX_COLUMN_PX = 24;

/** Fixed series order: the first Cycle line gets slot 1, the second slot 2. */
export function seriesSlot(label: string, labels: readonly string[]): 1 | 2 {
  return labels.indexOf(label) === 1 ? 2 : 1;
}

interface ColumnOptions extends FormatOptions {
  height: number;
  /** Lines in fixed order (series slots). */
  labels: readonly string[];
  /** Show x-axis labels (first and last only). */
  axis: boolean;
  /** Accessible name of the chart. */
  title: string;
}

/** Waste per ended Window as columns, 0..100%. Waste that cannot be measured is a hollow marker, not a zero column. */
export function wasteColumns(results: readonly CycleResult[], o: ColumnOptions): string {
  return columns(
    results.map((r) => ({
      share: r.waste?.share ?? null,
      label: r.label,
      estimated: r.waste?.basis === "estimated",
      faint: r.waste?.lowConfidence ?? false,
      axisLabel: formatTime(r.endedAt, o, "date"),
      tip: `${r.label} reset ${formatTime(r.endedAt, o)}: Waste ${formatShare(r.waste)}${confidenceNote(r.waste)}`,
    })),
    o,
  );
}

/**
 * Idle Capacity per Cycle as columns; the running Cycle is drawn faint and labelled "so far".
 * Time without readings stacks on top, hatched: unknown, never counted as idle.
 */
export function idleColumns(idle: readonly IdleEntry[], o: ColumnOptions): string {
  return columns(
    idle.map((i) => ({
      share: i.share,
      unknown: i.unknownShare,
      label: i.label,
      estimated: false,
      faint: i.running,
      axisLabel: i.running ? "so far" : formatTime(i.to, o, "date"),
      tip: `${i.label} ${i.running ? "running, so far" : `reset ${formatTime(i.to, o)}`}: Idle Capacity ${Math.round(i.share * 100)}%, unknown (no readings) ${Math.round(i.unknownShare * 100)}%`,
    })),
    o,
  );
}

interface Column {
  share: number | null;
  /** Unknown share stacked on top (no readings). */
  unknown?: number;
  label: string;
  estimated: boolean;
  faint: boolean;
  axisLabel: string;
  tip: string;
}

function columns(cols: readonly Column[], o: ColumnOptions): string {
  const plotH = o.height - PLOT_TOP - (o.axis ? AXIS_BAND : 4);
  const base = PLOT_TOP + plotH;
  const band = 100 / Math.max(cols.length, 1);
  const y = (share: number) => base - share * plotH;

  const marks = cols.map((c, i) => {
    const cx = band * (i + 0.5);
    const slot = seriesSlot(c.label, o.labels);
    const tip = escapeHtml(c.tip);
    const hit = `<rect class="hit" x="${pct(band * i)}" y="${PLOT_TOP}" width="${pct(band)}" height="${plotH}" tabindex="0" role="img" aria-label="${tip}" data-tip="${tip}"><title>${tip}</title></rect>`;
    if (c.share === null) {
      return `<g class="mark missing">${hit}<circle cx="${pct(cx)}" cy="${base - 5}" r="4" class="missing-dot"/></g>`;
    }
    const h = Math.max(c.share * plotH, 2);
    const cls = ["col", `s${slot}`, c.estimated ? "est" : "", c.faint ? "faint" : ""].filter(Boolean).join(" ");
    const w = `min(${MAX_COLUMN_PX}px, ${pct(band * 0.6)})`;
    const uh = (c.unknown ?? 0) * plotH;
    const unknown =
      uh >= 3 ? `<rect class="gap" x="-12" y="${y(c.share) - uh}" width="24" height="${uh - 2}" rx="${Math.min(4, (uh - 2) / 2)}"/>` : "";
    // A centered column: a <svg> placed at the band center, the bar drawn around x=0 with overflow visible.
    return `<g class="mark">${hit}<svg x="${pct(cx)}" y="0" overflow="visible" class="colwrap" style="--w:${w}"><rect class="${cls}" x="-12" y="${y(c.share)}" width="24" height="${h}" rx="${Math.min(4, h / 2)}"/><rect class="${cls} foot" x="-12" y="${base - Math.min(4, h / 2)}" width="24" height="${Math.min(4, h / 2)}"/>${unknown}</svg></g>`;
  });

  const last = cols.at(-1);
  const lastLabel =
    last && last.share !== null
      ? `<text class="val" x="${pct(band * (cols.length - 0.5))}" y="${y(last.share) - 6}" text-anchor="middle">${last.estimated ? "~" : ""}${Math.round(last.share * 100)}%</text>`
      : "";
  const axis = o.axis && cols.length
    ? `<text class="tick" x="${pct(band * 0.5)}" y="${base + 16}" text-anchor="${cols.length === 1 ? "middle" : "start"}" dx="${cols.length === 1 ? 0 : -8}">${escapeHtml(cols[0]!.axisLabel)}</text>` +
      (cols.length > 1
        ? `<text class="tick" x="${pct(band * (cols.length - 0.5))}" y="${base + 16}" text-anchor="end" dx="8">${escapeHtml(last!.axisLabel)}</text>`
        : "")
    : "";

  return svgFrame(o, plotH, `${gridLines(plotH)}${marks.join("")}${lastLabel}${axis}`);
}

interface DotOptions extends FormatOptions {
  height: number;
  title: string;
  range: Span;
  gaps: readonly Span[];
}

/** Session Waste on a time axis, with stretches without Snapshots hatched (never drawn as zero). */
export function sessionDots(sessions: readonly CycleResult[], o: DotOptions): string {
  const plotH = o.height - PLOT_TOP - AXIS_BAND;
  const base = PLOT_TOP + plotH;
  const from = Date.parse(o.range.from);
  const span = Math.max(Date.parse(o.range.to) - from, 1);
  const x = (iso: string) => Math.min(100, Math.max(0, ((Date.parse(iso) - from) / span) * 100));

  const gaps = o.gaps.map((g) => {
    const tip = escapeHtml(`No Snapshots ${formatTime(g.from, o)} to ${formatTime(g.to, o)}`);
    return `<rect class="gap" x="${pct(x(g.from))}" y="${PLOT_TOP}" width="${pct(Math.max(x(g.to) - x(g.from), 0.4))}" height="${plotH}" tabindex="0" data-tip="${tip}"><title>${tip}</title></rect>`;
  });
  const dots = sessions.map((s) => {
    const share = s.waste?.share ?? null;
    const tip = escapeHtml(`Session reset ${formatTime(s.endedAt, o)}: Waste ${formatShare(s.waste)}${confidenceNote(s.waste)}`);
    const cy = share === null ? base - 5 : base - share * plotH;
    const cls = share === null ? "missing-dot" : ["dot", s.waste!.basis === "estimated" ? "est" : "", s.waste!.lowConfidence ? "faint" : ""].join(" ");
    return `<g class="mark"><circle class="${cls}" cx="${pct(x(s.endedAt))}" cy="${cy}" r="4"/><circle class="hit" cx="${pct(x(s.endedAt))}" cy="${cy}" r="12" tabindex="0" role="img" aria-label="${tip}" data-tip="${tip}"><title>${tip}</title></circle></g>`;
  });
  const axis =
    `<text class="tick" x="0" y="${base + 16}" text-anchor="start">${escapeHtml(formatTime(o.range.from, o, "date"))}</text>` +
    `<text class="tick" x="100%" y="${base + 16}" text-anchor="end">${escapeHtml(formatTime(o.range.to, o, "date"))}</text>`;
  return svgFrame(o, plotH, `${gridLines(plotH)}${gaps.join("")}${dots.join("")}${axis}`);
}

/** Y ticks live in an HTML column beside the plot, so their text never scales with the plot. */
function svgFrame(o: { height: number; title: string }, plotH: number, body: string): string {
  const ticks = [1, 0.5, 0]
    .map((t) => `<span style="top:${PLOT_TOP + (1 - t) * plotH}px">${t * 100}%</span>`)
    .join("");
  return `<div class="chart" style="height:${o.height}px"><div class="yaxis" aria-hidden="true">${ticks}</div><svg class="plot" width="100%" height="${o.height}" role="group" aria-label="${escapeHtml(o.title)}">${body}</svg></div>`;
}

function gridLines(plotH: number): string {
  return [0, 0.5, 1]
    .map((t) => {
      const yy = PLOT_TOP + t * plotH;
      return `<line class="${t === 1 ? "baseline" : "grid"}" x1="0" x2="100%" y1="${yy}" y2="${yy}"/>`;
    })
    .join("");
}

/** 45° hatch for Estimated fills, defined once per page. */
export const HATCH_DEFS =
  '<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="6" class="hatch-line"/></pattern></defs></svg>';

function confidenceNote(waste: Waste | null): string {
  return waste?.lowConfidence ? " (low confidence: sparse readings before the Reset)" : "";
}

function pct(n: number): string {
  return `${Math.round(n * 1000) / 1000}%`;
}
