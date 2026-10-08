import { expect, test } from "bun:test";
import { buildReport } from "../src/report/build.ts";
import {
  type ClaudeClient,
  ClaudeSuggestions,
  MAX_SUGGESTION_CHARS,
  parseSuggestions,
  SUGGESTION_TARGET_CHARS,
} from "../src/report/claude-suggestions.ts";
import { SUGGESTION_CHARS } from "../src/report/card.ts";
import { input } from "./report-fixtures.ts";

const SETUP = "# Setup\n\n- Codex Team: code reviews\n- Cursor Team: rarely used, $20/month allowance\n";
const DRAFT_SETUP = `# Setup (DRAFT: fill in and remove this word)\n${SETUP}`;

/** Claude behind the interface: records each prompt, answers in turn (the last answer repeats) or fails. */
class FakeClaude implements ClaudeClient {
  prompts: { system: string; user: string }[] = [];
  private readonly answers: (string | Error)[];
  constructor(...answers: (string | Error)[]) {
    this.answers = answers;
  }
  async ask(prompt: { system: string; user: string }) {
    this.prompts.push(prompt);
    const answer = this.answers[Math.min(this.prompts.length - 1, this.answers.length - 1)]!;
    if (answer instanceof Error) throw answer;
    return answer;
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
  expect(user).toContain(`at most ${SUGGESTION_TARGET_CHARS} characters`);
  expect(user).toContain("one sentence");
  expect(user).toMatch(/never .*DRAFT/i);
});

const LONG =
  "Move all code reviews from Claude (Work) to Codex Team, because Codex reset with 62% wasted while Claude hit its limit twice this week, and keep it there.";
const SHORT = "Move code reviews to Codex: it reset with 62% wasted.";

test("parsing never cuts a Suggestion: long ones are kept whole for the caller to handle", () => {
  expect([...LONG].length).toBeGreaterThan(MAX_SUGGESTION_CHARS);
  expect(parseSuggestions(JSON.stringify({ suggestions: [LONG] }))).toEqual({ ok: true, items: [LONG] });
});

test("a too-long Suggestion is rewritten once by Claude, keeping its place, and never ends cut off", async () => {
  const claude = new FakeClaude(JSON.stringify({ suggestions: ["Use Cursor for side projects.", LONG] }), JSON.stringify({ suggestions: [SHORT] }));
  const result = await new ClaudeSuggestions({ client: claude, readSetup: () => SETUP }).suggest(report);
  expect(result).toEqual({ ok: true, items: ["Use Cursor for side projects.", SHORT] });
  expect(claude.prompts).toHaveLength(2);
  expect(claude.prompts[1]!.user).toContain(LONG);
  expect(claude.prompts[1]!.user).toContain(`at most ${SUGGESTION_TARGET_CHARS} characters`);
});

test("a Suggestion still too long after the rewrite, or a failed rewrite, is dropped rather than cut", async () => {
  const stillLong = new FakeClaude(JSON.stringify({ suggestions: [SHORT, LONG] }), JSON.stringify({ suggestions: [LONG] }));
  expect(await new ClaudeSuggestions({ client: stillLong, readSetup: () => SETUP }).suggest(report)).toEqual({ ok: true, items: [SHORT] });

  const rewriteFails = new FakeClaude(JSON.stringify({ suggestions: [SHORT, LONG] }), new Error("Claude API error (HTTP 529): Overloaded"));
  expect(await new ClaudeSuggestions({ client: rewriteFails, readSetup: () => SETUP }).suggest(report)).toEqual({ ok: true, items: [SHORT] });
});

const LONG_B =
  "Route every small side-project task from Claude (personal) to Copilot Student, which has used 0% of its 200 premium requests this month so far, so they all go to waste.";
const SHORT_B = "Route small side-project tasks to Copilot: 0% of 200 requests used.";

test("two long Suggestions are both rewritten, each keeping its own place", async () => {
  const claude = new FakeClaude(
    JSON.stringify({ suggestions: [LONG, SHORT, LONG_B] }),
    JSON.stringify({ suggestions: [SHORT, SHORT_B] }),
  );
  const result = await new ClaudeSuggestions({ client: claude, readSetup: () => SETUP }).suggest(report);
  expect(result).toEqual({ ok: true, items: [SHORT, SHORT, SHORT_B] });
});

test("a rewrite with a different number of Suggestions than sent drops the long ones, never misplacing a rewrite", async () => {
  const fewer = new FakeClaude(JSON.stringify({ suggestions: [LONG, SHORT, LONG_B] }), JSON.stringify({ suggestions: [SHORT_B] }));
  expect(await new ClaudeSuggestions({ client: fewer, readSetup: () => SETUP }).suggest(report)).toEqual({ ok: true, items: [SHORT] });

  // A rewrite that turns into a DRAFT remark is filtered, which also changes the count.
  const draftish = new FakeClaude(
    JSON.stringify({ suggestions: [LONG, SHORT, LONG_B] }),
    JSON.stringify({ suggestions: ["Fill in the prices in your Setup.", SHORT_B] }),
  );
  expect(await new ClaudeSuggestions({ client: draftish, readSetup: () => SETUP }).suggest(report)).toEqual({ ok: true, items: [SHORT] });
});

test("the card cuts at the same length a Suggestion may have, so a kept Suggestion is never cut", () => {
  expect(SUGGESTION_CHARS).toBe(MAX_SUGGESTION_CHARS);
});

test("Suggestions within the limit cost no second call", async () => {
  const claude = new FakeClaude(JSON.stringify({ suggestions: [SHORT] }));
  await new ClaudeSuggestions({ client: claude, readSetup: () => SETUP }).suggest(report);
  expect(claude.prompts).toHaveLength(1);
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
