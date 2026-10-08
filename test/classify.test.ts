import { describe, expect, test } from "bun:test";
import { classifyLine, type LineRole } from "../src/classify.ts";

const TABLE: [provider: string, label: string, role: LineRole][] = [
  ["claude", "Session", "session"],
  ["claude-work", "Session", "session"],
  ["codex", "Session", "session"],
  ["claude", "Weekly", "cycle"],
  ["claude-work", "Weekly", "cycle"],
  ["codex", "Weekly", "cycle"],
  ["cursor", "Total usage", "cycle"],
  ["copilot", "Premium", "cycle"],
  ["claude-work", "Extra usage spent", "overage"],
  ["cursor", "On-demand", "overage"],
  ["codex", "Workspace Credits", "overage"],
  ["cursor", "Auto usage", "submeter"],
  ["cursor", "API usage", "submeter"],
  ["copilot", "Chat", "ignored"],
];

describe("classifyLine (spec: line classification table)", () => {
  for (const [provider, label, role] of TABLE) {
    test(`${provider} / ${label} is ${role}`, () => {
      expect(classifyLine(provider, label)).toBe(role);
    });
  }

  test("an unknown line is unclassified, not dropped", () => {
    expect(classifyLine("claude", "Monthly")).toBe("unclassified");
    expect(classifyLine("new-provider", "Session")).toBe("unclassified");
  });
});
