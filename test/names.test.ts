import { expect, test } from "bun:test";
import { modelName, providerName } from "../src/names.ts";

test("Providers show their display names; an unknown id shows as is", () => {
  expect(["claude", "claude-work", "codex", "cursor", "copilot", "gemini"].map(providerName)).toEqual([
    "Claude",
    "Claude (Work)",
    "Codex",
    "Cursor",
    "Copilot",
    "gemini",
  ]);
});

test("models show friendly names; unknown ids show as is", () => {
  expect(
    [
      "claude-opus-5-5",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
      "claude-opus",
      "gpt-6.1-sol",
      "gpt-5-codex",
      "gpt-5",
      "codex-auto-review",
      "gemma4:26b",
    ].map(modelName),
  ).toEqual(["Opus 5.5", "Sonnet 5", "Haiku 4.5", "Opus", "GPT-6.1 Sol", "GPT-5 Codex", "GPT-5", "codex-auto-review", "gemma4:26b"]);
});
