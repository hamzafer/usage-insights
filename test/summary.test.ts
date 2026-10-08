import { expect, test } from "bun:test";
import { formatSummary } from "../src/summary.ts";
import type { Window } from "../src/window-model.ts";

function cycle(provider: string, endedAt: string | null, waste: Window["waste"], over: Partial<Window> = {}): Window {
  return { provider, label: "Weekly", role: "cycle", resetsAt: endedAt, readings: [], endedAt, waste, ...over };
}

test("lists ended Cycles per Provider with their Waste, flagging low confidence", () => {
  const out = formatSummary(
    [
      cycle("claude", "2026-10-01T09:00:00.000Z", {
        share: 0.3,
        lastReadingAt: "2026-10-01T08:55:00.000Z",
        lowConfidence: false,
        basis: "measured",
      }),
      cycle("claude", "2026-10-08T09:00:00.000Z", {
        share: 0.125,
        lastReadingAt: "2026-10-08T06:45:00.000Z",
        lowConfidence: true,
        basis: "measured",
      }),
      cycle("claude", null, null),
      cycle("claude", "2026-10-08T12:00:00.000Z", null, { label: "Session", role: "session" }),
      cycle("cursor", "2026-10-01T00:00:00.000Z", {
        share: 0.6,
        lastReadingAt: "2026-09-30T23:58:00.000Z",
        lowConfidence: false,
        basis: "estimated",
      }, { label: "Total usage" }),
    ],
    { timeZone: "UTC" },
  );

  expect(out).toBe(
    [
      "claude",
      "  Weekly  reset 2026-10-01 09:00  Waste  30%",
      "  Weekly  reset 2026-10-08 09:00  Waste  13%  low confidence: last reading 2h 15m before Reset",
      "",
      "cursor",
      "  Total usage  reset 2026-10-01 00:00  Waste ~60%",
    ].join("\n"),
  );
});

test("says so when no Cycle has ended yet", () => {
  expect(formatSummary([cycle("codex", null, null)])).toBe("No ended Cycles yet.");
});
