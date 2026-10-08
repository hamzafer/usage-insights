import { expect, test } from "bun:test";
import { buildReport } from "../src/report/build.ts";
import { type ClaudeClient, ClaudeSuggestions, MAX_SUGGESTION_CHARS, parseSuggestions } from "../src/report/claude-suggestions.ts";
import { input } from "./report-fixtures.ts";

const SETUP = "# Setup\n\n- Codex Team: code reviews\n- Cursor Team: rarely used, $20/month allowance\n";
const DRAFT_SETUP = `# Setup (DRAFT: fill in and remove this word)\n${SETUP}`;

/** Claude behind the interface: records the prompt, answers with a fixed text or fails. */
class FakeClaude implements ClaudeClient {
  prompts: { system: string; user: string }[] = [];
  constructor(private readonly answer: string | Error) {}
  async ask(prompt: { system: string; user: string }) {
    this.prompts.push(prompt);
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
}

const report = buildReport({ ...input, dataNotes: ["Token Backfill failed: ENOENT /Users/someone/secret/project/log.jsonl"] });

test("sends the Setup and the Report's numbers, and returns Claude's Suggestions", async () => {
  const claude = new FakeClaude('{"suggestions": ["Move code reviews from Codex to Cursor: its allowance sits idle."]}');
  const provider = new ClaudeSuggestions({ client: claude, readSetup: () => SETUP, timeZone: "UTC" });
  expect(await provider.suggest(report)).toEqual({ ok: true, items: ["Move code reviews from Codex to Cursor: its allowance sits idle."] });
  const user = claude.prompts[0]!.user;
  expect(user).toContain("Cursor Team: rarely used");
  expect(user).toContain("| Codex | Weekly |");
  expect(user).toContain("at most 3");
});

test("sends no raw log content or paths: data notes stay out of the prompt", async () => {
  const claude = new FakeClaude('{"suggestions": []}');
  await new ClaudeSuggestions({ client: claude, readSetup: () => SETUP, timeZone: "UTC" }).suggest(report);
  const prompt = claude.prompts[0]!;
  expect(prompt.user + prompt.system).not.toContain("/Users/");
  expect(prompt.user).not.toContain("ENOENT");
});

test("a DRAFT Setup is flagged, whether or not Claude answers", async () => {
  const ok = new ClaudeSuggestions({ client: new FakeClaude('{"suggestions": ["A."]}'), readSetup: () => DRAFT_SETUP });
  expect(await ok.suggest(report)).toEqual({ ok: true, items: ["A."], draftSetup: true });
  const failing = new ClaudeSuggestions({ client: new FakeClaude(new Error("Claude API error (HTTP 529): Overloaded")), readSetup: () => DRAFT_SETUP });
  expect(await failing.suggest(report)).toEqual({ ok: false, reason: "Claude API error (HTTP 529): Overloaded", draftSetup: true });
});

test("a failing Claude call or unreadable Setup is a failure with a reason, never a throw", async () => {
  const down = new ClaudeSuggestions({ client: new FakeClaude(new Error("Claude API did not answer within 60s")), readSetup: () => SETUP });
  expect(await down.suggest(report)).toEqual({ ok: false, reason: "Claude API did not answer within 60s" });
  const noSetup = new ClaudeSuggestions({
    client: new FakeClaude("{}"),
    readSetup: () => {
      throw new Error("EACCES: permission denied");
    },
  });
  expect(await noSetup.suggest(report)).toEqual({ ok: false, reason: "Setup file could not be read: EACCES: permission denied" });
  const prose = new ClaudeSuggestions({ client: new FakeClaude("No JSON here."), readSetup: () => SETUP });
  expect(await prose.suggest(report)).toEqual({ ok: false, reason: "Claude's answer was not valid JSON" });
});

test("reads the suggestions array from a JSON answer", () => {
  expect(parseSuggestions('{"suggestions": ["Move code reviews to Codex.", "Use Cursor for side projects."]}')).toEqual({
    ok: true,
    items: ["Move code reviews to Codex.", "Use Cursor for side projects."],
  });
});

test("finds the JSON inside extra prose or a code fence", () => {
  const prose = 'Here you go:\n```json\n{"suggestions": ["Move reviews to Codex."]}\n```\nHope that helps {really}.';
  expect(parseSuggestions(prose)).toEqual({ ok: true, items: ["Move reviews to Codex."] });
  expect(parseSuggestions('Sure! {"suggestions": ["A."]} Done.')).toEqual({ ok: true, items: ["A."] });
});

test("keeps at most 3, trimmed, dropping empty and non-text items", () => {
  const answer = JSON.stringify({ suggestions: [" One. ", "", 42, "Two.", "Three.", "Four."] });
  expect(parseSuggestions(answer)).toEqual({ ok: true, items: ["One.", "Two.", "Three."] });
});

test("a bare array is accepted too, and an empty list means no Suggestions", () => {
  expect(parseSuggestions('["Only one."]')).toEqual({ ok: true, items: ["Only one."] });
  expect(parseSuggestions('{"suggestions": []}')).toEqual({ ok: true, items: [] });
});

test("the prompt asks for short, one-sentence Suggestions about the Setup, never about filling it in", async () => {
  const claude = new FakeClaude('{"suggestions": []}');
  await new ClaudeSuggestions({ client: claude, readSetup: () => DRAFT_SETUP, timeZone: "UTC" }).suggest(report);
  const user = claude.prompts[0]!.user;
  expect(user).toContain(`at most ${MAX_SUGGESTION_CHARS} characters`);
  expect(user).toContain("one sentence");
  expect(user).toMatch(/never .*DRAFT/i);
});

test("a long Suggestion is shortened to 120 characters on a word boundary, the same in Markdown and Telegram", () => {
  const long = "Move all code reviews from Claude (Work) to Codex Team, because Codex reset with 62% wasted while Claude hit its limit twice this week.";
  const { items } = parseSuggestions(JSON.stringify({ suggestions: [long] })) as { items: string[] };
  const item = items[0]!;
  expect([...item].length).toBeLessThanOrEqual(MAX_SUGGESTION_CHARS);
  expect(item).toEndWith("…");
  const kept = item.slice(0, -1);
  expect(long.startsWith(kept)).toBe(true);
  expect(long[kept.length]).toBe(" ");
});

test("a Suggestion that only says the Setup is a DRAFT or to fill in prices is dropped (the DRAFT line says it)", () => {
  const answer = JSON.stringify({
    suggestions: [
      "Fill in the plan prices in your Setup so the numbers can be weighed.",
      "Your Setup is still a DRAFT; complete it.",
      "Move code reviews to Codex: it reset with 62% wasted.",
    ],
  });
  expect(parseSuggestions(answer)).toEqual({ ok: true, items: ["Move code reviews to Codex: it reset with 62% wasted."] });
});

test("malformed or missing JSON is a failure with a reason, not a throw", () => {
  expect(parseSuggestions('{"suggestions": ["unterminated')).toEqual({ ok: false, reason: "Claude's answer was not valid JSON" });
  expect(parseSuggestions("I would move reviews to Codex.")).toEqual({ ok: false, reason: "Claude's answer was not valid JSON" });
  expect(parseSuggestions('{"ideas": ["x"]}')).toEqual({ ok: false, reason: "Claude's answer had no suggestions list" });
});
