import { HATCH_DEFS, idleColumns, seriesSlot, sessionDots, wasteColumns } from "./charts.ts";
import { escapeHtml as e, formatAmount, formatDuration, formatShare, formatTime, type FormatOptions } from "./format.ts";
import { formatTokens } from "../summary.ts";
import { providerName } from "../names.ts";
import { MIN_CALIBRATION_MOVEMENT, MIN_CALIBRATION_SAMPLES } from "../calibration.ts";
import type { CycleTokens, Share } from "../token-shares.ts";
import { type DataHealth, type ProjectsPage, type ProviderHistory, type ProviderOverview, type RunningCycle, SNAPSHOT_GAP_MS } from "./view-model.ts";

/**
 * HTML pages from view models. Pure string building: no data access here (ADR 0002 keeps the
 * data layer separate so hosting behind a login later only swaps the server).
 */

export interface PageContext extends FormatOptions {
  /** Providers for the navigation. */
  providers: readonly string[];
  now: string;
}

export function renderOverview(providers: readonly ProviderOverview[], health: DataHealth, ctx: PageContext): string {
  const body = providers.length
    ? providers.map((p) => overviewSection(p, health, ctx)).join("")
    : `<p class="empty">No Cycles recorded yet. Start the Recorder (<code>bun run record</code>, or the launchd job in the README) and Snapshots will show up here.</p>`;
  return page("Overview", "/", ctx, `<h1>Allowance use</h1>${healthBanner(health, ctx)}${body}${encodingKey()}`);
}

export function renderHistory(h: ProviderHistory, ctx: PageContext): string {
  const labels = [...new Set(h.cycles.map((c) => c.label))];
  const opts = { ...ctx, labels };
  const cycleChart = h.cycles.length
    ? wasteColumns(h.cycles, { ...opts, height: 200, axis: true, title: "Waste per Cycle" })
    : `<p class="empty">No ended Cycles yet.</p>`;
  const sessionChart = h.sessions.length
    ? sessionDots(h.sessions, { ...ctx, height: 200, title: "Waste per Session", range: h.range, gaps: h.gaps })
    : `<p class="empty">No ended Sessions with Waste yet.</p>`;
  const idleChart = h.idle.length
    ? idleColumns(h.idle, { ...opts, labels: [...new Set(h.idle.map((i) => i.label))], height: 180, axis: true, title: "Idle Capacity per Cycle" })
    : `<p class="empty">No Sessions recorded for this Provider, so no Idle Capacity.</p>`;

  const body = `
  <h1>${e(providerName(h.provider))}</h1>
  <p class="lede">Since ${e(formatTime(h.range.from, ctx, "date"))}. ${h.gaps.length ? `${h.gaps.length} stretch${h.gaps.length === 1 ? "" : "es"} without Snapshots, hatched in the Session chart.` : "No stretches without Snapshots."}</p>
  ${seriesLegend(labels)}
  <section class="block">
    <h2>Waste per Cycle</h2>
    <p class="hint">Allowance still unused at each Reset.</p>
    ${cycleChart}
    ${table(
      ["Cycle", "Reset", "Waste", "Confidence"],
      h.cycles.map((c) => [c.label, formatTime(c.endedAt, ctx), formatShare(c.waste), c.waste?.lowConfidence ? "low" : c.waste ? "ok" : "n/a"]),
    )}
  </section>
  <section class="block">
    <h2>Waste per Session</h2>
    <p class="hint">Each dot is a started Session at its Reset. Sessions that never started count as Idle Capacity instead.</p>
    ${sessionChart}
    ${table(
      ["Session", "Reset", "Waste", "Confidence"],
      h.sessions.map((s) => [s.label, formatTime(s.endedAt, ctx), formatShare(s.waste), s.waste?.lowConfidence ? "low" : s.waste ? "ok" : "n/a"]),
    )}
  </section>
  <section class="block">
    <h2>Idle Capacity per Cycle</h2>
    <p class="hint">Share of each Cycle with no Session open, when its allowance could not be used at all. Time without readings is unknown and stacks on top, hatched; it never counts as idle.</p>
    ${idleChart}
    ${table(
      ["Cycle", "Span", "Idle", "Share", "Unknown"],
      h.idle.map((i) => [
        i.label,
        `${formatTime(i.from, ctx)} to ${i.running ? "now" : formatTime(i.to, ctx)}`,
        formatDuration(i.idleMs),
        `${Math.round(i.share * 100)}%${i.running ? " so far" : ""}`,
        i.unknownMs > 0 ? formatDuration(i.unknownMs) : "none",
      ]),
    )}
  </section>
  ${encodingKey()}`;
  return page(providerName(h.provider), `/provider/${h.provider}`, ctx, body);
}

export function renderHealth(h: DataHealth, ctx: PageContext): string {
  const body = `
  <h1>Data health</h1>
  <p class="lede">Failures are listed here, never filled in as zero usage.</p>
  <section class="block">
    <h2>Last Snapshot per Provider</h2>
    ${table(
      ["Provider", "Last Snapshot", "State"],
      h.providers.map((p) => [
        providerName(p.provider),
        p.lastSnapshotAt ? formatTime(p.lastSnapshotAt, ctx) : "none (Backfill only)",
        { html: p.stale ? `<span class="status warn"><span aria-hidden="true">!</span> stale</span>` : `<span class="status ok"><span aria-hidden="true">✓</span> current</span>` },
      ]),
      "No readings recorded yet.",
      true,
    )}
  </section>
  <section class="block">
    <h2>Unclassified lines</h2>
    <p class="hint">Lines OpenUsage reports that nobody has mapped to a role yet. Stored, not analysed.</p>
    ${table(
      ["Provider", "Line", "Last seen"],
      h.unclassified.map((u) => [providerName(u.provider), u.label, formatTime(u.lastSeenAt, ctx)]),
      "None. Every line has a role.",
      true,
    )}
  </section>
  <section class="block">
    <h2>Recorder gaps</h2>
    <p class="hint">Recording runs that got no Snapshot, newest first.</p>
    ${table(
      ["When", "Reason"],
      h.recorderGaps.map((g) => [formatTime(g.recordedAt, ctx), g.reason]),
      "No recorder gaps.",
      true,
    )}
  </section>
  <section class="block">
    <h2>Failed runs</h2>
    <p class="hint">Backfill and Report runs that failed, newest first. The Recorder starts the Backfills once per hour.</p>
    ${table(
      ["When", "Run", "Reason"],
      h.failedRuns.map((r) => [formatTime(r.at, ctx), jobName(r.job), r.reason ?? ""]),
      "No failed runs.",
      true,
    )}
  </section>
  <section class="block">
    <h2>Stretches without Snapshots</h2>
    <p class="hint">More than ${SNAPSHOT_GAP_MS / 60_000} minutes between a Provider's Snapshots, newest first. This time counts as unknown, never as zero usage or Idle Capacity.</p>
    ${table(
      ["Provider", "From", "To", "Length"],
      h.snapshotGaps.map((g) => [
        providerName(g.provider),
        formatTime(g.from, ctx),
        formatTime(g.to, ctx),
        formatDuration(Date.parse(g.to) - Date.parse(g.from)),
      ]),
      "None.",
      true,
    )}
  </section>${calibrationSection(h, ctx)}`;
  return page("Data health", "/health", ctx, body);
}

/** Bars per list on the Projects and models page; the rest fold into one "Other" bar. */
const TOP_BARS = 8;

export function renderProjects(p: ProjectsPage, ctx: PageContext): string {
  const body = p.providers.length
    ? p.providers.map((prov) => projectsSection(prov.provider, prov.cycles, ctx)).join("")
    : `<p class="empty">No token data yet. Read the Claude Code and Codex logs with <code>bun run backfill:tokens</code> (rerun anytime, it reads only new lines).</p>`;
  return page(
    "Projects and models",
    "/projects",
    ctx,
    `<h1>Projects and models</h1>
  <p class="lede">Share of each Cycle's tokens per Project (a git repository, worktrees included) and per model. Tokens are counted from the logs, input, cache and output together; they are not a share of the allowance.</p>
  ${body}`,
  );
}

function projectsSection(provider: string, cycles: readonly CycleTokens[], ctx: PageContext): string {
  const name = providerName(provider);
  return `
  <section class="provider">
    <header class="provider-head"><h2>${e(name)}</h2><span class="meta">Last ${cycles.length} Cycle${cycles.length === 1 ? "" : "s"} with tokens, newest first</span></header>
    ${cycles
      .map((c) => {
        const span = `${formatTime(c.from, ctx, "date")} to ${formatTime(c.to, ctx, "date")}`;
        const notes = [
          c.running && "running",
          c.inferred && `<span class="flag" title="No Snapshot recorded this Reset: dates stepped in Cycle lengths from one that was">dates inferred</span>`,
        ].filter(Boolean);
        return `
    <div class="cycle-tokens">
      <h3>${e(c.label)}, ${e(span)} <span class="meta">${e(formatTokens(c.total))} tokens${notes.length ? `, ${notes.join(", ")}` : ""}</span></h3>
      <div class="share-cols">
        ${shareBars("Projects", "Project", c.byProject, `${name} ${span}`)}
        ${shareBars("Models", "Model", c.byModel, `${name} ${span}`)}
      </div>
    </div>`;
      })
      .join("")}
  </section>`;
}

/**
 * Ranked shares as single-hue bars (length is the share, text in ink, a tip per bar), then the
 * full list as a table.
 */
function shareBars(title: string, column: string, shares: readonly Share[], context: string): string {
  const top = shares.slice(0, TOP_BARS);
  const rest = shares.slice(TOP_BARS);
  const rows = rest.length
    ? [
        ...top,
        {
          name: `Other (${rest.length})`,
          tokens: rest.reduce((sum, s) => sum + s.tokens, 0),
          share: rest.reduce((sum, s) => sum + s.share, 0),
        },
      ]
    : top;
  return `<div class="shares"><h4>${e(title)}</h4><ul class="bars" aria-label="${e(`${title}, ${context}`)}">${rows
    .map((s) => {
      const tip = e(`${s.name}: ${percent(s.share)} of tokens (${formatTokens(s.tokens)})`);
      return `<li class="bar-row" tabindex="0" data-tip="${tip}" aria-label="${tip}"><span class="bar-name">${e(s.name)}</span><span class="bar-track"><span class="bar" style="width:${pctOf(Math.max(s.share, 0.004))}"></span></span><span class="bar-val">${percent(s.share)}</span></li>`;
    })
    .join("")}</ul>${table(
    [column, "Tokens", "Share"],
    shares.map((s) => [s.name, formatTokens(s.tokens), percent(s.share)]),
  )}</div>`;
}

function percent(share: number): string {
  return share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`;
}

export function renderMessage(title: string, message: string, ctx: PageContext): string {
  return page(title, "", ctx, `<h1>${e(title)}</h1><p class="lede">${e(message)}</p>`);
}

function overviewSection(p: ProviderOverview, health: DataHealth, ctx: PageContext): string {
  const snap = health.providers.find((h) => h.provider === p.provider);
  const lastSnap = snap?.lastSnapshotAt
    ? `Last Snapshot ${e(formatTime(snap.lastSnapshotAt, ctx))}${snap.stale ? ` <span class="status warn"><span aria-hidden="true">!</span> stale</span>` : ""}`
    : "Backfill only, no Snapshots";
  const labels = [...new Set(p.recentCycles.map((c) => c.label))];

  const last = p.lastCycles.length
    ? p.lastCycles
        .map(
          (c) =>
            `<dd class="figure${c.waste?.basis === "estimated" ? " est" : ""}">${e(formatShare(c.waste))}</dd><dd class="note">${e(c.label)}, reset ${e(formatTime(c.endedAt, ctx))}${c.waste?.lowConfidence ? ` <span class="flag" title="The last reading came more than 30 minutes before the Reset">low confidence</span>` : ""}</dd>`,
        )
        .join("")
    : `<dd class="figure none">n/a</dd><dd class="note">No Cycle has ended yet</dd>`;
  const hits = p.limitHits.count
    ? `<dd class="figure">${p.limitHits.count}</dd><dd class="note">${p.limitHits.stillBlocked ? "blocked now, " : ""}blocked ${e(formatDuration(p.limitHits.blockedMs))} in total</dd>`
    : `<dd class="figure">0</dd><dd class="note">never blocked</dd>`;
  const spent = p.overage.filter((o) => o.spent > 0);
  const overage = spent.length
    ? spent
        .map((o) => `<dd class="figure">${e(formatAmount(o.spent, o.unit))}</dd><dd class="note">${e(o.overageLabel)}, ${o.cycleEndedAt ? "last Cycle" : "this Cycle"}</dd>`)
        .join("")
    : `<dd class="figure">none</dd><dd class="note">no paid usage recorded</dd>`;

  return `
  <section class="provider">
    <header class="provider-head">
      <h2><a href="/provider/${encodeURIComponent(p.provider)}">${e(providerName(p.provider))}</a></h2>
      <span class="meta">${lastSnap}</span>
    </header>
    ${p.running.map((r) => meter(r, ctx)).join("")}
    <dl class="figures">
      <div><dt>Last Cycle Waste</dt>${last}</div>
      <div><dt>Limit Hits, 28 days</dt>${hits}</div>
      <div><dt>Overage</dt>${overage}</div>
      <div class="trend"><dt>Waste, last ${p.recentCycles.length} Cycle${p.recentCycles.length === 1 ? "" : "s"}</dt><dd>${
        p.recentCycles.length
          ? wasteColumns(p.recentCycles, { ...ctx, labels, height: 72, axis: false, title: `${providerName(p.provider)} Waste per Cycle` })
          : `<span class="note">Shows once a Cycle ends</span>`
      }</dd></div>
    </dl>
  </section>`;
}

/**
 * The running Cycle as an allowance meter: used so far (solid), where Pace says usage ends up by
 * the Reset (wash), the rest is the Waste it is heading for. The tick marks how far through the
 * Cycle we are, so ahead or behind reads at a glance.
 */
function meter(r: RunningCycle, ctx: PageContext): string {
  const used = clamp(r.usedShare);
  const projected = r.pace.projectedShare === null ? used : clamp(Math.max(r.pace.projectedShare, used));
  const est = r.pace.basis === "estimated" ? "~" : "";
  const pace =
    r.pace.expectedWaste === null
      ? "Pace needs two readings"
      : `Pace: heading for ${est}${Math.round(r.pace.expectedWaste * 100)}% Waste${r.pace.projectedLimitHitAt ? `, limit at ${formatTime(r.pace.projectedLimitHitAt, ctx)}` : ""}`;
  const reset = r.resetsAt ? `Reset ${formatTime(r.resetsAt, ctx)}` : "Reset unknown";
  const label = `${r.label}: ${est}${Math.round(used * 100)}% used. ${pace}. ${reset}.`;
  return `
    <div class="running">
      <div class="running-head"><span class="running-label">${e(r.label)}, running</span><span class="meta">${e(reset)}</span></div>
      <div class="meter${est ? " est" : ""}" role="img" aria-label="${e(label)}" tabindex="0" data-tip="${e(label)}">
        <span class="m-used" style="width:${pctOf(used)}"></span>
        <span class="m-proj" style="left:${pctOf(used)};width:${pctOf(projected - used)}"></span>
        ${r.elapsedShare === null ? "" : `<span class="m-now" style="left:${pctOf(r.elapsedShare)}"><span>${Math.round(r.elapsedShare * 100)}% of Cycle gone</span></span>`}
      </div>
      <p class="running-foot"><strong>${est}${Math.round(used * 100)}% used</strong><span>${e(pace)}</span></p>
    </div>`;
}

/** `backfill:codex` → "Codex Backfill", `backfill:tokens` → "Token Backfill", `report` → "Report". */
function jobName(job: string): string {
  if (job === "report") return "Report";
  const backfill = /^backfill:(.+)$/.exec(job);
  if (!backfill) return job;
  const name = backfill[1] === "tokens" ? "Token" : providerName(backfill[1]!);
  return `${name} Backfill`;
}

function healthBanner(h: DataHealth, ctx: PageContext): string {
  const dayAgo = Date.parse(ctx.now) - 24 * 3_600_000;
  const recent = h.recorderGaps.filter((g) => Date.parse(g.recordedAt) >= dayAgo).length;
  const stale = h.providers.filter((p) => p.stale && p.lastSnapshotAt).length;
  const failed = h.failedRuns.filter((r) => Date.parse(r.at) >= dayAgo).length;
  const issues = [
    recent && `${recent} recorder gap${recent === 1 ? "" : "s"} in the last 24 hours`,
    failed && `${failed} failed Backfill or Report run${failed === 1 ? "" : "s"} in the last 24 hours`,
    stale && `${stale} Provider${stale === 1 ? "" : "s"} without a fresh Snapshot`,
    h.unclassified.length && `${h.unclassified.length} unclassified line${h.unclassified.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  if (!issues.length) return "";
  return `<p class="banner" role="status"><span class="status warn"><span aria-hidden="true">!</span></span> ${e(issues.join(", "))}. <a href="/health">See data health</a></p>`;
}

function seriesLegend(labels: readonly string[]): string {
  if (labels.length < 2) return "";
  return `<ul class="legend">${labels.map((l) => `<li><span class="swatch s${seriesSlot(l, labels)}"></span>${e(l)}</li>`).join("")}</ul>`;
}

function encodingKey(): string {
  return `
  <footer class="key" aria-label="How to read the charts">
    <span><span class="swatch s1"></span>Measured</span>
    <span><span class="swatch s1 est"></span>~ Estimated (from tokens)</span>
    <span><span class="swatch s1 faint"></span>Low confidence or still running</span>
    <span><span class="swatch hollow"></span>Waste unknown</span>
    <span><span class="swatch gapkey"></span>No Snapshots</span>
  </footer>`;
}

/** Claude calibration state and the past Cycles' Estimated Waste it gives (ticket #8). */
function calibrationSection(h: DataHealth, ctx: PageContext): string {
  return `
  <section class="block">
    <h2>Claude calibration</h2>
    <p class="hint">Tokens per 1% of a Session or Cycle, learned per account from live Snapshots. Ready after ${MIN_CALIBRATION_SAMPLES} intervals where used% moved and tokens were logged, and ${MIN_CALIBRATION_MOVEMENT} points of movement. Until then past Claude Cycles show tokens only.</p>
    ${table(
      ["Account", "Line", "State", "Samples", "Movement", "Tokens per 1%"],
      h.calibration.map((c) => [
        providerName(c.provider),
        c.label,
        { html: c.ready ? `<span class="status ok"><span aria-hidden="true">✓</span> ready</span>` : `<span class="status warn"><span aria-hidden="true">…</span> calibrating (tokens only)</span>` },
        `${c.samples} of ${MIN_CALIBRATION_SAMPLES}`,
        `${Number(c.movement.toFixed(1))} of ${MIN_CALIBRATION_MOVEMENT} points`,
        c.tokensPerPercent === null ? "n/a" : formatTokens(c.tokensPerPercent),
      ]),
      "No Claude Snapshots or tokens yet.",
      true,
    )}
  </section>
  <section class="block">
    <h2>Estimated Waste (Claude, from tokens)</h2>
    <p class="hint">Converted from tokens with the calibration, so always marked ~ and never combined with Measured Waste. Cycles with Measured Waste are not estimated.</p>
    ${table(
      ["Account", "Cycle", "Reset", "Tokens", "Waste"],
      h.estimatedWaste.map((w) => [
        providerName(w.provider),
        w.inferred ? `${w.label} (inferred)` : w.label,
        formatTime(w.to, ctx),
        formatTokens(w.tokens),
        formatShare(w),
      ]),
      "None yet: calibrating.",
      true,
    )}
  </section>`;
}

type Cell = string | { html: string };

function table(head: readonly string[], rows: readonly Cell[][], empty = "No rows yet.", open = false): string {
  if (!rows.length) return `<p class="empty">${e(empty)}</p>`;
  const cell = (c: Cell) => (typeof c === "string" ? e(c) : c.html);
  return `<details class="table"${open ? " open" : ""}><summary>Table (${rows.length} row${rows.length === 1 ? "" : "s"})</summary><div class="scroll"><table><thead><tr>${head
    .map((h) => `<th scope="col">${e(h)}</th>`)
    .join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
}

function page(title: string, path: string, ctx: PageContext, body: string): string {
  const link = (href: string, text: string) =>
    `<a href="${href}"${href === path ? ' aria-current="page"' : ""}>${e(text)}</a>`;
  const nav = [
    link("/", "Overview"),
    ...ctx.providers.map((p) => link(`/provider/${encodeURIComponent(p)}`, providerName(p))),
    link("/projects", "Projects and models"),
    link("/health", "Data health"),
  ].join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="data:,">
<title>${e(title)} | Usage Insights</title>
<style>${CSS}</style>
</head>
<body>
${HATCH_DEFS}
<header class="top">
  <a class="mark" href="/">Usage Insights</a>
  <nav aria-label="Pages">${nav}</nav>
</header>
<main>${body}
<p class="stamp">Rendered ${e(formatTime(ctx.now, ctx))}. Reload for new Snapshots.</p>
</main>
<div id="tip" role="tooltip" hidden></div>
<script>${SCRIPT}</script>
</body>
</html>`;
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function pctOf(share: number): string {
  return `${Math.round(clamp(share) * 1000) / 10}%`;
}

/** Hover and focus tooltip for every element with data-tip. */
const SCRIPT = `
(() => {
  const tip = document.getElementById("tip");
  const show = (el) => {
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    const y = r.top - tip.offsetHeight - 8;
    tip.style.left = x + "px";
    tip.style.top = (y < 8 ? r.bottom + 8 : y) + scrollY + "px";
    document.querySelectorAll(".active").forEach((a) => a.classList.remove("active"));
    el.closest(".mark")?.classList.add("active");
  };
  const hide = () => { tip.hidden = true; document.querySelectorAll(".active").forEach((a) => a.classList.remove("active")); };
  for (const ev of ["pointerover", "focusin"]) document.addEventListener(ev, (e) => { const el = e.target.closest?.("[data-tip]"); if (el) show(el); });
  for (const ev of ["pointerout", "focusout"]) document.addEventListener(ev, (e) => { if (e.target.closest?.("[data-tip]")) hide(); });
})();
`;

/*
 * Tokens. Cool paper and slate ink, so the two series hues (validated with the dataviz palette
 * checker against these surfaces) and the hatch are the only color on the page.
 */
const CSS = `
:root {
  color-scheme: light;
  --page: #eef1f4; --surface: #fbfcfd; --ink: #161a1f; --ink-2: #4c5561; --muted: #6f7884;
  --grid: #dfe3e8; --axis: #b9c0c8; --hair: rgba(22,26,31,.10);
  --s1: #2a78d6; --s2: #eb6834; --s1-wash: rgba(42,120,214,.16);
  --warn: #b26b00; --ok: #0a7d0a; --gap-ink: rgba(76,85,97,.38);
  --font: "Avenir Next", Avenir, "Segoe UI", system-ui, -apple-system, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0f1216; --surface: #171b20; --ink: #eef1f4; --ink-2: #aab3be; --muted: #8b94a0;
    --grid: #272d34; --axis: #3a424b; --hair: rgba(238,241,244,.10);
    --s1: #3987e5; --s2: #d95926; --s1-wash: rgba(57,135,229,.22);
    --warn: #fab219; --ok: #0ca30c; --gap-ink: rgba(170,179,190,.30);
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0f1216; --surface: #171b20; --ink: #eef1f4; --ink-2: #aab3be; --muted: #8b94a0;
  --grid: #272d34; --axis: #3a424b; --hair: rgba(238,241,244,.10);
  --s1: #3987e5; --s2: #d95926; --s1-wash: rgba(57,135,229,.22);
  --warn: #fab219; --ok: #0ca30c; --gap-ink: rgba(170,179,190,.30);
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--page); color: var(--ink); font: 400 15px/1.5 var(--font); }
a { color: inherit; text-underline-offset: 3px; text-decoration-color: var(--axis); }
a:hover { text-decoration-color: currentColor; }
:focus-visible { outline: 2px solid var(--s1); outline-offset: 2px; }
code { font-size: .9em; }
.top { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 24px; padding: 14px 16px; max-width: 1040px; margin: 0 auto; }
.mark { font-weight: 700; letter-spacing: -.01em; text-decoration: none; font-size: 16px; }
nav { display: flex; flex-wrap: wrap; gap: 2px 16px; font-size: 14px; color: var(--ink-2); }
nav a { text-decoration: none; padding: 2px 0; border-bottom: 2px solid transparent; }
nav a[aria-current="page"] { color: var(--ink); border-bottom-color: var(--s1); }
main { max-width: 1040px; margin: 0 auto; padding: 8px 16px 48px; }
h1 { font-size: 34px; line-height: 1.1; font-weight: 600; letter-spacing: -.02em; margin: 20px 0 8px; }
h2 { font-size: 18px; font-weight: 600; margin: 0; letter-spacing: -.005em; }
.lede { color: var(--ink-2); margin: 0 0 24px; max-width: 64ch; }
.hint { color: var(--muted); font-size: 13px; margin: 2px 0 12px; max-width: 70ch; }
.empty { color: var(--ink-2); font-size: 14px; margin: 8px 0; }
.meta { color: var(--muted); font-size: 13px; }
.banner { background: var(--surface); border: 1px solid var(--hair); border-left: 3px solid var(--warn); border-radius: 6px; padding: 10px 14px; font-size: 14px; margin: 0 0 20px; }
.provider { background: var(--surface); border: 1px solid var(--hair); border-radius: 10px; padding: 18px 20px 20px; margin: 0 0 16px; }
.provider-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 16px; margin-bottom: 14px; }
.provider-head h2 { font-size: 22px; }
.provider-head h2 a { text-decoration: none; }
.provider-head h2 a:hover { text-decoration: underline; }
.running { margin: 0 0 18px; }
.running-head { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; margin-bottom: 6px; }
.running-label { color: var(--ink-2); }
.meter { position: relative; height: 14px; border-radius: 4px; background: var(--grid); overflow: visible; }
.m-used, .m-proj { position: absolute; top: 0; bottom: 0; }
.m-used { left: 0; background: var(--s1); border-radius: 4px 0 0 4px; }
.m-proj { background: var(--s1-wash); }
.meter.est .m-used { background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6'%3E%3Cpath d='M-1 7 7-1M5 7l2-2M-1 1l2-2' stroke='white' stroke-opacity='.45' stroke-width='1.5'/%3E%3C/svg%3E"), var(--s1); }
.m-now { position: absolute; top: -5px; bottom: -5px; width: 2px; margin-left: -1px; background: var(--ink); border-radius: 1px; }
.m-now span { position: absolute; top: calc(100% + 2px); left: 50%; transform: translateX(-50%); white-space: nowrap; font-size: 11px; color: var(--muted); }
.running-foot { display: flex; flex-wrap: wrap; gap: 2px 16px; margin: 22px 0 0; font-size: 14px; color: var(--ink-2); }
.running-foot strong { color: var(--ink); font-weight: 600; }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px 20px; margin: 0; border-top: 1px solid var(--grid); padding-top: 14px; }
.figures dt { font-size: 13px; color: var(--ink-2); margin-bottom: 2px; }
.figures dd { margin: 0; }
.figure { font-size: 30px; font-weight: 600; letter-spacing: -.02em; line-height: 1.15; }
.figure.none { color: var(--muted); }
.note { font-size: 13px; color: var(--muted); }
.flag { color: var(--warn); font-weight: 600; white-space: nowrap; }
.trend { grid-column: span 2; min-width: 0; }
@media (max-width: 520px) { .trend { grid-column: 1 / -1; } .figure { font-size: 26px; } h1 { font-size: 28px; } .provider { padding: 16px; } }
.status { font-weight: 600; white-space: nowrap; }
.status.warn { color: var(--warn); }
.status.ok { color: var(--ok); }
.block { background: var(--surface); border: 1px solid var(--hair); border-radius: 10px; padding: 18px 20px; margin: 0 0 16px; }
.legend { list-style: none; display: flex; gap: 16px; padding: 0; margin: 0 0 12px; font-size: 13px; color: var(--ink-2); }
.key { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 12px; color: var(--muted); margin: 20px 0 0; }
.key > span, .legend li { display: inline-flex; align-items: center; gap: 6px; }
.swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; }
.swatch.s1 { background: var(--s1); } .swatch.s2 { background: var(--s2); }
.swatch.est { background: repeating-linear-gradient(45deg, var(--s1) 0 2px, color-mix(in srgb, var(--s1) 35%, transparent) 2px 4px); }
.swatch.faint { opacity: .4; }
.swatch.hollow { border: 2px solid var(--muted); border-radius: 50%; }
.swatch.gapkey { background: repeating-linear-gradient(45deg, var(--gap-ink) 0 1.5px, transparent 1.5px 5px); outline: 1px solid var(--grid); }
.chart { position: relative; display: grid; grid-template-columns: 36px 1fr; }
.yaxis { position: relative; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.yaxis span { position: absolute; right: 8px; transform: translateY(-50%); }
.plot { display: block; overflow: visible; }
.plot .grid { stroke: var(--grid); stroke-width: 1; shape-rendering: crispEdges; }
.plot .baseline { stroke: var(--axis); stroke-width: 1; shape-rendering: crispEdges; }
.plot .tick { fill: var(--muted); font-size: 11px; }
.plot .val { fill: var(--ink); font-size: 12px; font-weight: 600; }
.plot .hit { fill: transparent; cursor: default; outline: none; }
.plot .mark.active .hit, .plot .hit:focus-visible { fill: var(--hair); }
.colwrap rect { --cw: min(24px, var(--w)); width: var(--cw); x: calc(var(--cw) / -2); }
.col.s1 { fill: var(--s1); } .col.s2 { fill: var(--s2); }
.col.est { fill: url(#hatch); }
.hatch-bg { fill: var(--s1); } .hatch-line { stroke: var(--surface); stroke-opacity: .55; stroke-width: 2; }
g.faint, .dot.faint { opacity: .4; }
.dot { fill: var(--s1); stroke: var(--surface); stroke-width: 2; }
.dot.est { fill: url(#hatch); }
.missing-dot { fill: var(--surface); stroke: var(--muted); stroke-width: 2; }
.gap { fill: url(#gaphatch); outline: none; }
.gaphatch-bg { fill: var(--gap-ink); fill-opacity: .18; } .gaphatch-line { stroke: var(--muted); stroke-width: 1.5; stroke-opacity: .6; }
.gap:focus-visible, .gap:hover { opacity: .7; }
.cycle-tokens { border-top: 1px solid var(--grid); padding: 14px 0 6px; }
.cycle-tokens:first-of-type { border-top: 0; padding-top: 0; }
.cycle-tokens h3 { font-size: 15px; font-weight: 600; margin: 0 0 10px; }
.cycle-tokens h3 .meta { font-weight: 400; margin-left: 6px; }
.share-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px 32px; }
.shares h4 { font-size: 13px; font-weight: 600; color: var(--ink-2); margin: 0 0 6px; }
.bars { list-style: none; margin: 0; padding: 0; }
.bar-row { display: grid; grid-template-columns: minmax(80px, 38%) 1fr 40px; align-items: center; gap: 10px; padding: 3px 4px; border-radius: 4px; font-size: 13px; outline: none; }
.bar-row:hover, .bar-row:focus-visible { background: var(--hair); }
.bar-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
.bar-track { position: relative; height: 10px; }
.bar { position: absolute; left: 0; top: 0; bottom: 0; background: var(--s1); border-radius: 0 4px 4px 0; min-width: 2px; }
.bar-val { text-align: right; color: var(--ink); font-variant-numeric: tabular-nums; }
details.table { margin-top: 10px; font-size: 13px; }
details.table summary { color: var(--ink-2); cursor: pointer; width: max-content; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; margin-top: 8px; min-width: 100%; }
th, td { text-align: left; padding: 6px 16px 6px 0; border-bottom: 1px solid var(--grid); font-variant-numeric: tabular-nums; white-space: nowrap; }
th { color: var(--ink-2); font-weight: 600; }
.stamp { color: var(--muted); font-size: 12px; margin-top: 24px; }
#tip { position: absolute; z-index: 10; max-width: min(320px, calc(100vw - 16px)); background: var(--ink); color: var(--page); font-size: 12px; line-height: 1.4; padding: 6px 9px; border-radius: 6px; pointer-events: none; }
@media (forced-colors: active) { .col, .dot, .m-used { forced-color-adjust: none; } }
`;
