import { expect, test } from "bun:test";
import { type ReportDeps, runReport } from "../src/report/run.ts";
import type { Messenger } from "../src/report/telegram.ts";
import { input, NOW } from "./report-fixtures.ts";

class FakeMessenger implements Messenger {
  sent: string[] = [];
  async send(text: string) {
    this.sent.push(text);
  }
}

function deps(overrides: Partial<ReportDeps> = {}) {
  const messenger = new FakeMessenger();
  const saved: { file: string; markdown: string }[] = [];
  const printed: string[] = [];
  const logged: string[] = [];
  const ran: string[] = [];
  const d: ReportDeps = {
    now: () => new Date(NOW),
    backfills: [
      { name: "Codex", run: () => void ran.push("codex") },
      { name: "Token", run: () => void ran.push("tokens") },
    ],
    load: () => {
      ran.push("load");
      return { readings: input.readings, gaps: input.gaps, tokens: input.tokens };
    },
    messenger,
    save: (file, markdown) => void saved.push({ file, markdown }),
    print: (text) => void printed.push(text),
    log: (line) => void logged.push(line),
    timeZone: "UTC",
    ...overrides,
  };
  return { d, messenger, saved, printed, logged, ran };
}

test("runs the Backfills first, saves the full Report and sends the short message", async () => {
  const { d, messenger, saved, ran } = deps();
  const result = await runReport(d);
  expect(ran).toEqual(["codex", "tokens", "load"]);
  expect(result.ok).toBe(true);
  expect(saved.map((s) => s.file)).toEqual(["reports/2026-10-12.md"]);
  expect(saved[0]!.markdown).toContain("## Numbers");
  expect(messenger.sent).toHaveLength(1);
  expect(messenger.sent[0]).toStartWith("Usage Insights Report\n");
  expect(messenger.sent[0]).toContain("Full Report: reports/2026-10-12.md");
});

test("a failed Backfill is logged and noted in the Report, which still goes out", async () => {
  const { d, messenger, saved, logged } = deps({
    backfills: [
      {
        name: "Codex",
        run: () => {
          throw new Error("sessions dir unreadable");
        },
      },
    ],
  });
  await runReport(d);
  expect(logged.some((l) => l.includes("Codex Backfill failed: sessions dir unreadable"))).toBe(true);
  expect(saved[0]!.markdown).toContain("- Codex Backfill failed: sessions dir unreadable");
  expect(messenger.sent[0]).toContain("Codex Backfill failed: sessions dir unreadable");
});

test("if building fails, a short failure message is sent instead", async () => {
  const { d, messenger, saved } = deps({
    load: () => {
      throw new Error("database is locked");
    },
  });
  const result = await runReport(d);
  expect(result.ok).toBe(false);
  expect(saved).toEqual([]);
  expect(messenger.sent).toEqual(["Usage Insights Report failed: database is locked"]);
});

test("--test prefixes the message with [TEST]", async () => {
  const { d, messenger } = deps({ test: true });
  await runReport(d);
  expect(messenger.sent[0]).toStartWith("[TEST] Usage Insights Report\n");

  const failing = deps({ test: true, load: () => { throw new Error("boom"); } });
  await runReport(failing.d);
  expect(failing.messenger.sent).toEqual(["[TEST] Usage Insights Report failed: boom"]);
});

test("--dry-run prints the message and the Report, and sends and saves nothing", async () => {
  const { d, messenger, saved, printed } = deps({ dryRun: true });
  await runReport(d);
  expect(messenger.sent).toEqual([]);
  expect(saved).toEqual([]);
  expect(printed[0]).toStartWith("Usage Insights Report\n");
  expect(printed.join("\n")).toContain("## Numbers");
});

test("a failed send is an error for the caller (launchd's log shows it)", async () => {
  const { d } = deps({
    messenger: {
      send: async () => {
        throw new Error("Telegram send failed (HTTP 401): Unauthorized");
      },
    },
  });
  await expect(runReport(d)).rejects.toThrow("Unauthorized");
});

test("Suggestions from the extension point reach the message; a throwing provider does not stop the Report", async () => {
  const withSuggestions = deps({ suggestions: { suggest: async () => ({ ok: true, items: ["Use Codex for reviews."] }) } });
  await runReport(withSuggestions.d);
  expect(withSuggestions.messenger.sent[0]).toContain("1. Use Codex for reviews.");

  const throwing = deps({
    suggestions: {
      suggest: async () => {
        throw new Error("no key");
      },
    },
  });
  await runReport(throwing.d);
  expect(throwing.messenger.sent[0]).toContain("Suggestions could not be written: no key");
});
