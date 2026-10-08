import { expect, test } from "bun:test";
import { overagePerCycle } from "../src/overage.ts";
import { deriveWindows, type Reading } from "../src/window-model.ts";

function reading(at: string, used: number, resetsAt: string | null, over: Partial<Reading> = {}): Reading {
  return {
    provider: "claude-work",
    label: "Weekly",
    role: "cycle",
    used,
    limit: 100,
    resetsAt,
    fetchedAt: at,
    source: "openusage",
    ...over,
  };
}

const NOW = "2026-10-12T00:00:00.000Z";
const spent = (at: string, used: number): Reading =>
  reading(at, used, null, { label: "Extra usage spent", role: "overage", limit: 200 });

test("Overage per Cycle is the growth of the Provider's Overage within the Cycle, in its own unit", () => {
  const cycles = deriveWindows(
    [
      reading("2026-10-01T10:00:00.000Z", 50, "2026-10-08T09:00:00.000Z"),
      reading("2026-10-08T09:10:00.000Z", 1, "2026-10-15T09:00:00.000Z"),
    ],
    NOW,
  );
  const overage = [
    spent("2026-10-01T10:00:00.000Z", 10),
    spent("2026-10-05T10:00:00.000Z", 22.5),
    spent("2026-10-08T08:00:00.000Z", 30),
    // Overage reset its own counter (new month), then grew again inside the next Cycle.
    spent("2026-10-09T08:00:00.000Z", 0),
    spent("2026-10-10T08:00:00.000Z", 4),
  ];

  expect(overagePerCycle(cycles, overage, NOW)).toEqual([
    {
      provider: "claude-work",
      cycleLabel: "Weekly",
      cycleEndedAt: "2026-10-08T09:00:00.000Z",
      overageLabel: "Extra usage spent",
      unit: "$",
      spent: 20,
    },
    {
      provider: "claude-work",
      cycleLabel: "Weekly",
      cycleEndedAt: null,
      overageLabel: "Extra usage spent",
      unit: "$",
      spent: 4,
    },
  ]);
});

test("Codex Overage is in credits; Providers without Overage lines get no entry", () => {
  const cycles = deriveWindows(
    [
      reading("2026-10-08T10:00:00.000Z", 10, "2026-10-15T09:00:00.000Z", { provider: "codex" }),
      reading("2026-10-08T10:00:00.000Z", 10, "2026-10-15T09:00:00.000Z", { provider: "claude" }),
    ],
    NOW,
  );
  const credits = [
    reading("2026-10-08T10:00:00.000Z", 100, "2026-11-01T00:00:00.000Z", {
      provider: "codex",
      label: "Workspace Credits",
      role: "overage",
      limit: 500,
    }),
    reading("2026-10-09T10:00:00.000Z", 160, "2026-11-01T00:00:00.000Z", {
      provider: "codex",
      label: "Workspace Credits",
      role: "overage",
      limit: 500,
    }),
  ];

  expect(overagePerCycle(cycles, credits, NOW)).toEqual([
    expect.objectContaining({ provider: "codex", unit: "credits", spent: 60 }),
  ]);
});
