import { expect, test } from "bun:test";
import { buildReport } from "../src/report/build.ts";
import { renderMarkdown, renderNumbers, renderTelegram } from "../src/report/render.ts";
import { input } from "./report-fixtures.ts";

const report = buildReport({ ...input, dataNotes: ["Codex Backfill failed: disk unreadable"] });
const options = { timeZone: "UTC", reportFile: "reports/2026-10-12.md" };

test("numbers section", () => {
  expect(renderNumbers(report, options)).toMatchSnapshot();
});

test("Telegram message", () => {
  expect(renderTelegram(report, options)).toMatchSnapshot();
});

test("the full Markdown holds the numbers, data notes and no Suggestions section until there are some", () => {
  const md = renderMarkdown(report, options);
  expect(md).toStartWith("# Usage Insights Report: 2026-10-05 to 2026-10-12");
  expect(md).toContain(renderNumbers(report, options));
  expect(md).toContain("Codex Backfill failed: disk unreadable");
  expect(md).not.toContain("## Suggestions");
});

test("Suggestions, when given, appear in the Markdown and the Telegram message", () => {
  const suggestions = { ok: true as const, items: ["Move code reviews to Codex."] };
  expect(renderMarkdown(report, { ...options, suggestions })).toContain("## Suggestions\n\n1. Move code reviews to Codex.");
  expect(renderTelegram(report, { ...options, suggestions })).toContain("1. Move code reviews to Codex.");
  const failed = { ok: false as const, reason: "API unreachable" };
  expect(renderMarkdown(report, { ...options, suggestions: failed })).toContain("Suggestions could not be written: API unreachable");
});

test("an empty week says so instead of showing zeros", () => {
  const empty = buildReport({ readings: [], gaps: [], tokens: [], now: "2026-10-12T09:00:00.000Z" });
  const text = renderTelegram(empty, options);
  expect(text).toContain("No Cycle reset this week");
  expect(text).toContain("No token data");
  expect(renderNumbers(empty, options)).toContain("No readings");
});
