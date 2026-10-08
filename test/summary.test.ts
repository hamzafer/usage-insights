import { describe, expect, test } from "bun:test";
import { formatSessions, formatSummary } from "../src/summary.ts";
import { deriveWindows, type Reading, type Window } from "../src/window-model.ts";

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

describe("Sessions section", () => {
  const session = (at: string, used: number, resetsAt: string | null): Reading => ({
    provider: "codex",
    label: "Session",
    role: "session",
    used,
    limit: 100,
    resetsAt,
    fetchedAt: at,
    source: "openusage",
  });
  const weekly = (at: string, used: number, resetsAt: string): Reading => ({
    ...session(at, used, resetsAt),
    label: "Weekly",
    role: "cycle",
  });
  const now = "2026-10-10T00:00:00.000Z";

  test("lists Waste for every started Session and Idle Capacity per Cycle", () => {
    const windows = deriveWindows(
      [
        weekly("2026-10-01T09:00:00.000Z", 0, "2026-10-08T09:00:00.000Z"),
        weekly("2026-10-08T08:55:00.000Z", 50, "2026-10-08T09:00:00.000Z"),
        weekly("2026-10-08T09:05:00.000Z", 0, "2026-10-15T09:00:00.000Z"),
        session("2026-10-02T13:55:00.000Z", 30, "2026-10-02T14:00:00.000Z"),
        session("2026-10-02T15:00:00.000Z", 10, "2026-10-02T19:00:00.000Z"),
        session("2026-10-03T12:00:00.000Z", 0, null),
        session("2026-10-09T23:00:00.000Z", 40, "2026-10-10T02:00:00.000Z"),
      ],
      now,
    );

    expect(formatSessions(windows, now, { timeZone: "UTC" })).toBe(
      [
        "Sessions",
        "codex",
        "  Session  reset 2026-10-02 14:00  Waste  70%",
        "  Session  reset 2026-10-02 19:00  Waste  90%  low confidence: last reading 4h before Reset",
        // Readings are days apart, so most of each Cycle is unknown rather than idle (ADR 0001).
        "  Idle Capacity  Weekly  reset 2026-10-08 09:00  5m   0%  unknown 6d 13h 55m",
        "  Idle Capacity  Weekly  running so far          5m   0%  unknown 1d 11h 55m",
      ].join("\n"),
    );
  });

  test("is empty when no Session line was recorded", () => {
    expect(formatSessions([], now)).toBe("");
  });
});
