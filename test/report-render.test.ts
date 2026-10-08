import { expect, test } from "bun:test";
import type { Pace } from "../src/pace.ts";
import { buildReport, type Report } from "../src/report/build.ts";
import { renderMarkdown, renderNumbers, renderTelegram } from "../src/report/render.ts";
import { TELEGRAM_TEXT_LIMIT } from "../src/report/telegram.ts";
import { input } from "./report-fixtures.ts";

const report = buildReport({ ...input, dataNotes: ["Codex Backfill failed: disk unreadable"] });
const options = { timeZone: "UTC", reportFile: "reports/2026-10-12.md" };
const suggestions = {
  ok: true as const,
  items: ["Move code reviews to Codex.", "Start Claude (Work) tasks earlier in the week.", "Drop Copilot."],
};

test("numbers section", () => {
  expect(renderNumbers(report, options)).toMatchSnapshot();
});

test("Telegram card (HTML)", () => {
  expect(renderTelegram(report, { ...options, suggestions })).toMatchSnapshot();
});

test("the full Markdown holds the numbers, data notes and no Suggestions section until there are some", () => {
  const md = renderMarkdown(report, options);
  expect(md).toStartWith("# Usage Insights Report: 2026-10-05 to 2026-10-12");
  expect(md).toContain(renderNumbers(report, options));
  expect(md).toContain("Codex Backfill failed: disk unreadable");
  expect(md).not.toContain("## Suggestions");
});

test("the Markdown uses display names for Providers and models", () => {
  const numbers = renderNumbers(report, options);
  expect(numbers).toContain("| Codex | Weekly |");
  expect(numbers).toContain("Claude (Work) Extra usage spent");
  expect(numbers).toContain("Sonnet 68%");
  expect(numbers).toContain("GPT-5 Codex");
  expect(numbers).not.toContain("| codex |");
  expect(numbers).not.toContain("claude-sonnet");
});

test("Suggestions, when given, appear in the Markdown and the Telegram card", () => {
  const one = { ok: true as const, items: ["Move code reviews to Codex."] };
  expect(renderMarkdown(report, { ...options, suggestions: one })).toContain("## Suggestions\n\n1. Move code reviews to Codex.");
  expect(renderTelegram(report, { ...options, suggestions: one })).toContain("<b>💡 Suggestions</b>\n1. Move code reviews to Codex.");
  const failed = { ok: false as const, reason: "API unreachable" };
  expect(renderMarkdown(report, { ...options, suggestions: failed })).toContain("Suggestions unavailable: API unreachable");
  expect(renderTelegram(report, { ...options, suggestions: failed })).toContain("💡 <i>Suggestions unavailable: API unreachable</i>");
});

test("long Suggestions are cut to about 140 characters in Telegram and kept whole in the Markdown", () => {
  const long = "Move every code review and every refactor to Codex, ".repeat(5).trim();
  const s = { ok: true as const, items: [long] };
  const line = renderTelegram(report, { ...options, suggestions: s }).split("\n").find((l) => l.startsWith("1. "))!;
  expect(line.length).toBeLessThanOrEqual(3 + 140);
  expect(line).toEndWith("…");
  // Cut on a word boundary: never mid-word.
  const kept = line.slice(3, -1);
  expect(long.startsWith(kept)).toBe(true);
  expect(long[kept.length]).toMatch(/[\s,]/);
  expect(renderMarkdown(report, { ...options, suggestions: s })).toContain(long);
});

test("while the Setup is a DRAFT, the Suggestions section says so", () => {
  const draft = { ok: true as const, items: ["Move code reviews to Codex."], draftSetup: true };
  expect(renderMarkdown(report, { ...options, suggestions: draft })).toContain(
    "## Suggestions\n\nSetup is a DRAFT: check setup.md in the data directory and remove DRAFT from its first line.\n\n1. Move code reviews to Codex.",
  );
  expect(renderTelegram(report, { ...options, suggestions: draft })).toContain("<i>Setup is a DRAFT: edit setup.md</i>");
  const failedDraft = { ok: false as const, reason: "timeout", draftSetup: true };
  expect(renderMarkdown(report, { ...options, suggestions: failedDraft })).toContain("Setup is a DRAFT");
  expect(renderMarkdown(report, { ...options, suggestions: { ok: true, items: ["A."] } })).not.toContain("DRAFT");
});

test("Estimated Waste is marked ~, and a stepped Cycle span says its dates are inferred in the Markdown", () => {
  const estimated = {
    ...report,
    cycleWaste: [
      {
        provider: "claude-work",
        label: "Weekly",
        resetAt: "2026-10-08T09:00:00.000Z",
        waste: { share: 0.4, lastReadingAt: "2026-10-08T09:00:00.000Z", lowConfidence: false, basis: "estimated" as const },
        inferred: true,
      },
    ],
    trend: {
      ...report.trend,
      waste: [{ provider: "claude-work", label: "Weekly", basis: "estimated" as const, thisWeek: 0.4, previous: null, previousCycles: 0 }],
    },
  };
  expect(renderTelegram(estimated, options)).toContain("Claude (Work) reset 1× · ~40% wasted");
  expect(renderNumbers(estimated, options)).toContain("| Claude (Work) | Weekly | 2026-10-08 09:00 | ~40% (dates inferred) |");
});

test("an empty week says so instead of showing zeros", () => {
  const empty = buildReport({ readings: [], gaps: [], tokens: [], now: "2026-10-12T09:00:00.000Z" });
  const text = renderTelegram(empty, options);
  expect(text).toContain("No running Cycles.");
  expect(text).toContain("No Cycle reset this week.");
  expect(text).toContain("No token data this week.");
  expect(renderNumbers(empty, options)).toContain("No readings");
});

const WEEK = 7 * 24 * 3_600_000;

function pace(provider: string, over: Partial<Pace>): Pace {
  return {
    provider,
    label: "Weekly",
    resetsAt: "2026-10-18T00:00:00.000Z",
    lastReadingAt: "2026-10-12T08:00:00.000Z",
    usedShare: 0.5,
    periodMs: WEEK,
    projectedShare: 0.9,
    expectedWaste: 0.1,
    projectedLimitHitAt: null,
    basis: "measured",
    ...over,
  };
}

function runningNow(paces: Pace[]): string[] {
  const text = renderTelegram({ ...report, pace: paces }, options);
  const lines = text.split("\n");
  const start = lines.indexOf("<b>▶ Running now</b>") + 1;
  return lines.slice(start, lines.indexOf("", start));
}

test("Running now: one dot per Provider by the documented thresholds, worst first", () => {
  const lines = runningNow([
    pace("cursor", { expectedWaste: 0.1, projectedShare: 0.9 }),
    // Maxes out 4h before its Reset: fine.
    pace("claude", { usedShare: 0.6, expectedWaste: 0, projectedShare: 1, projectedLimitHitAt: "2026-10-17T20:00:00.000Z" }),
    pace("codex", { usedShare: 0.13, expectedWaste: 0.52, projectedShare: 0.48 }),
    pace("copilot", { usedShare: 0, expectedWaste: 1, projectedShare: 0, resetsAt: "2026-11-01T00:00:00.000Z", periodMs: 30 * 24 * 3_600_000 }),
    pace("claude-work", { usedShare: 0.004, expectedWaste: 0.99, projectedShare: 0.01 }),
  ]);
  expect(lines).toEqual([
    "🔴 Copilot        untouched · resets 1 Nov",
    "🔴 Claude (Work)  0% used · ~99% waste ahead",
    "🟡 Codex          13% used · ~52% waste ahead",
    "🟢 Claude         on pace to max out Sat",
    "🟢 Cursor         on track",
  ]);
});

test("a Limit Hit projected well before the Reset is a warning; a missing rate is grey", () => {
  const lines = runningNow([
    // Out 1 day 16h before Reset (24% of the Cycle): yellow.
    pace("codex", { expectedWaste: 0, projectedShare: 1, projectedLimitHitAt: "2026-10-16T08:00:00.000Z" }),
    // Out 3 days before Reset: red.
    pace("claude", { expectedWaste: 0, projectedShare: 1, projectedLimitHitAt: "2026-10-15T00:00:00.000Z" }),
    pace("cursor", { expectedWaste: null, projectedShare: null }),
  ]);
  expect(lines).toEqual([
    "🔴 Claude  on pace to max out Thu",
    "🟡 Codex   on pace to max out Fri",
    "⚪ Cursor  needs more readings",
  ]);
});

test("all dynamic text is HTML-escaped", () => {
  const nasty: Report = {
    ...report,
    pace: [pace("a<b>&c", {})],
    top: { total: 100, byProject: [{ name: "<script>", tokens: 100, share: 1 }], byModel: [{ name: "m&m", tokens: 100, share: 1 }] },
    dataNotes: ["Token Backfill failed: <oops> & more"],
  };
  const text = renderTelegram(nasty, { ...options, suggestions: { ok: true, items: ["Use <code> & stop"] } });
  expect(text).toContain("a&lt;b&gt;&amp;c");
  expect(text).toContain("&lt;script&gt;");
  expect(text).toContain("m&amp;m");
  expect(text).toContain("&lt;oops&gt; &amp; more");
  expect(text).toContain("Use &lt;code&gt; &amp; stop");
  expect(text).not.toContain("<script>");
  expect(text).not.toContain("<oops>");
});

test("Details sit in an expandable blockquote; a young recording gets one 'Week N' line instead of unknown time", () => {
  const text = renderTelegram(report, options);
  expect(text).toContain("<blockquote expandable>");
  const details = text.slice(text.indexOf("<blockquote expandable>"), text.indexOf("</blockquote>"));
  expect(details).toContain("🏆 alpha 72%, beta 20% · Sonnet 68%, Opus 20%");
  expect(details).toContain("📈 Tokens 1M (↑ 7.5× usual)");
  expect(details).toContain("⏳ Week 4 of recording: numbers sharpen");
  expect(details).not.toContain("Unknown time");

  const older = { ...report, coverage: { ...report.coverage, recordingSince: "2026-08-01T00:00:00.000Z" } };
  const oldDetails = renderTelegram(older, options);
  expect(oldDetails).toContain("⏳ Unknown time: Claude 6d 23h 55m, Claude (Work) 7d, Codex 7d · 1 recorder gap");
});

test("Last week sums up reset Cycles, Limit Hits and Overage compactly", () => {
  const text = renderTelegram(report, options);
  expect(text).toContain("<b>✅ Last week</b>\nCodex reset 1× · 20% wasted (↓ from 40%)\n🚫 Limit hits: 1 (was 0/wk) · blocked 2h   💸 Overage: $15");
});

test("a typical card stays short, and a huge one stays under Telegram's cap", () => {
  expect(renderTelegram(report, { ...options, suggestions }).length).toBeLessThan(1500);
  const huge: Report = {
    ...report,
    dataNotes: Array.from({ length: 80 }, (_, i) => `Backfill ${i} failed: ${"x".repeat(60)}`),
  };
  const text = renderTelegram(huge, { ...options, suggestions });
  expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
  expect(text.split("<b>").length).toBe(text.split("</b>").length);
});

test("Overage lines that spent nothing are left out of the total; none spent shows as $0", () => {
  const zero: Report = {
    ...report,
    overage: [
      { provider: "claude-work", label: "Extra usage spent", unit: "$", spent: 0 },
      { provider: "codex", label: "Workspace Credits", unit: "credits", spent: 0 },
    ],
  };
  expect(renderTelegram(zero, options)).toContain("💸 Overage: $0\n");
  const some: Report = { ...zero, overage: [zero.overage[0]!, { ...zero.overage[1]!, spent: 12 }] };
  expect(renderTelegram(some, options)).toContain("💸 Overage: 12 credits\n");
});
