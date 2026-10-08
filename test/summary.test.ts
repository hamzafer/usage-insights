import { describe, expect, test } from "bun:test";
import { formatSessions, formatSummary, formatTokenShares } from "../src/summary.ts";
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

describe("formatTokenShares", () => {
  const share = (name: string, tokens: number, s: number) => ({ name, tokens, share: s });
  const span = (from: string, to: string, running: boolean, inferred: boolean) => ({ provider: "claude", label: "Weekly", from, to, running, inferred });

  test("lists the last two Cycles per Provider with token share per Project and model", () => {
    const out = formatTokenShares(
      [
        {
          ...span("2026-09-21T00:00:00.000Z", "2026-09-28T00:00:00.000Z", false, true),
          total: 50,
          byProject: [share("old", 50, 1)],
          byModel: [share("claude-opus-5", 50, 1)],
        },
        {
          ...span("2026-09-28T00:00:00.000Z", "2026-10-05T00:00:00.000Z", false, true),
          total: 1_250_000,
          byProject: [share("alpha", 1_000_000, 0.8), share("(other)", 250_000, 0.2)],
          byModel: [share("claude-opus-5", 1_250_000, 1)],
        },
        {
          ...span("2026-10-05T00:00:00.000Z", "2026-10-12T00:00:00.000Z", true, false),
          total: 7_000,
          byProject: [1, 2, 3, 4, 5, 6, 7].map((i) => share(`p${i}`, 1000, 1 / 7)),
          byModel: [share("claude-sonnet-5", 7_000, 1)],
        },
      ],
      { timeZone: "UTC" },
    );
    expect(out).toBe(
      [
        "Projects and models (token share per Cycle)",
        "claude",
        "  Weekly  2026-09-28 00:00 to 2026-10-05 00:00  1.3M tokens  Cycle inferred",
        "    Projects  alpha 80%, (other) 20%",
        "    Models    claude-opus-5 100%",
        "  Weekly  2026-10-05 00:00 to 2026-10-12 00:00  7k tokens  running",
        "    Projects  p1 14%, p2 14%, p3 14%, p4 14%, p5 14%, 2 more 29%",
        "    Models    claude-sonnet-5 100%",
      ].join("\n"),
    );
  });

  test("is empty without token data", () => {
    expect(formatTokenShares([])).toBe("");
  });
});
