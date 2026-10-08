import { expect, test } from "bun:test";
import type { TokenEvent } from "../src/store.ts";
import { tokenCycles, tokensByCycle, topUsage } from "../src/token-shares.ts";
import { deriveWindows } from "../src/window-model.ts";
import { reading } from "./dashboard-fixtures.ts";

// Synthetic token events and readings only (ADR 0002).

function event(provider: string, at: string, project: string | null, model: string, tokens: number): TokenEvent {
  return { provider, at, project, model, input: tokens / 2, cacheWrite: 0, cacheRead: tokens / 4, output: tokens / 4 };
}

const NOW = "2026-10-10T12:00:00.000Z";

/** claude: a Weekly Cycle that reset 2026-10-05 00:00 and a running one resetting 2026-10-12 00:00. */
const windows = deriveWindows(
  [
    reading("claude", "Weekly", "cycle", 40, "2026-10-05T00:00:00.000Z", "2026-10-01T00:00:00.000Z"),
    reading("claude", "Weekly", "cycle", 90, "2026-10-05T00:00:00.000Z", "2026-10-04T23:00:00.000Z"),
    reading("claude", "Weekly", "cycle", 10, "2026-10-12T00:00:00.000Z", "2026-10-05T01:00:00.000Z"),
  ],
  NOW,
);

test("Cycles come from the Window Model, extended back in Cycle lengths to the first tokens", () => {
  const spans = tokenCycles("claude", windows, "2026-09-20T00:00:00.000Z", NOW);
  expect(spans).toEqual([
    { provider: "claude", label: "Weekly", from: "2026-09-14T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z", running: false, inferred: true },
    { provider: "claude", label: "Weekly", from: "2026-09-21T00:00:00.000Z", to: "2026-09-28T00:00:00.000Z", running: false, inferred: true },
    { provider: "claude", label: "Weekly", from: "2026-09-28T00:00:00.000Z", to: "2026-10-05T00:00:00.000Z", running: false, inferred: true },
    { provider: "claude", label: "Weekly", from: "2026-10-05T00:00:00.000Z", to: "2026-10-12T00:00:00.000Z", running: true, inferred: false },
  ]);
});

test("a Provider without recorded Cycles gets weekly Cycles ending Monday 00:00 UTC, marked inferred", () => {
  const spans = tokenCycles("codex", [], "2026-10-06T00:00:00.000Z", NOW);
  expect(spans).toEqual([
    { provider: "codex", label: "Weekly", from: "2026-10-05T00:00:00.000Z", to: "2026-10-12T00:00:00.000Z", running: true, inferred: true },
  ]);
});

test("token share per Project and model per Cycle, largest first, newest Cycle last", () => {
  const events = [
    event("claude", "2026-10-03T10:00:00.000Z", "/x/alpha", "claude-opus-5", 300),
    event("claude", "2026-10-03T11:00:00.000Z", "/y/beta", "claude-sonnet-5", 100),
    event("claude", "2026-10-05T00:00:00.000Z", "/x/alpha", "claude-opus-5", 100), // at the Reset: the new Cycle
    event("claude", "2026-10-06T10:00:00.000Z", null, "claude-opus-5", 100),
    event("claude", "2026-10-06T11:00:00.000Z", "/z/beta", "claude-opus-5", 200), // same folder name as /y/beta
    event("claude-work", "2026-10-06T11:00:00.000Z", "/x/alpha", "claude-opus-5", 999), // another Provider
  ];

  const cycles = tokensByCycle(events.filter((e) => e.provider === "claude"), windows, NOW);

  expect(cycles).toEqual([
    {
      provider: "claude",
      label: "Weekly",
      from: "2026-09-28T00:00:00.000Z",
      to: "2026-10-05T00:00:00.000Z",
      running: false,
      inferred: true,
      total: 400,
      byProject: [
        { name: "alpha", tokens: 300, share: 0.75 },
        { name: "beta", tokens: 100, share: 0.25 },
      ],
      byModel: [
        { name: "claude-opus-5", tokens: 300, share: 0.75 },
        { name: "claude-sonnet-5", tokens: 100, share: 0.25 },
      ],
    },
    {
      provider: "claude",
      label: "Weekly",
      from: "2026-10-05T00:00:00.000Z",
      to: "2026-10-12T00:00:00.000Z",
      running: true,
      inferred: false,
      total: 400,
      byProject: [
        { name: "beta", tokens: 200, share: 0.5 },
        { name: "(other)", tokens: 100, share: 0.25 },
        { name: "alpha", tokens: 100, share: 0.25 },
      ],
      byModel: [{ name: "claude-opus-5", tokens: 400, share: 1 }],
    },
  ]);
});

test("each Provider gets its own Cycles", () => {
  const events = [
    event("claude", "2026-10-06T10:00:00.000Z", "/x/alpha", "claude-opus-5", 100),
    event("codex", "2026-10-06T10:00:00.000Z", "/x/alpha", "gpt-5.5", 100),
  ];
  expect(tokensByCycle(events, windows, NOW).map((c) => [c.provider, c.inferred])).toEqual([
    ["claude", false],
    ["codex", true],
  ]);
});

test("top Projects and models for a period, across Providers unless filtered", () => {
  const events = [
    event("claude", "2026-10-06T10:00:00.000Z", "/x/alpha", "claude-opus-5", 100),
    event("codex", "2026-10-07T10:00:00.000Z", "/x/beta", "gpt-5.5", 300),
    event("codex", "2026-10-09T10:00:00.000Z", "/x/beta", "gpt-5.5", 999), // after the period
  ];
  const period = { from: "2026-10-06T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" };

  expect(topUsage(events, period)).toEqual({
    total: 400,
    byProject: [
      { name: "beta", tokens: 300, share: 0.75 },
      { name: "alpha", tokens: 100, share: 0.25 },
    ],
    byModel: [
      { name: "gpt-5.5", tokens: 300, share: 0.75 },
      { name: "claude-opus-5", tokens: 100, share: 0.25 },
    ],
  });
  expect(topUsage(events, { ...period, providers: ["claude"], limit: 1 }).byProject).toEqual([{ name: "alpha", tokens: 100, share: 1 }]);
});
