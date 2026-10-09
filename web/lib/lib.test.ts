import { describe, expect, test } from "bun:test";
import { deltaPoints, paceText, percent, resetText, weekdayOrDate } from "./format";
import { planTiles } from "./plan-tiles";
import { byProviderOrder, providerColor } from "./providers";
import { statusLook } from "./status";
import type { Overview, Pace, ProviderOverview, RunningCycle } from "./types";

// Pure web logic, run by the root `bun test`. Synthetic values only.
const NOW = "2026-10-05T12:00:00.000Z"; // a Monday
const TZ = "UTC";

function pace(over: Partial<Pace> = {}): Pace {
  return {
    provider: "codex",
    label: "Weekly",
    resetsAt: "2026-10-08T00:00:00.000Z",
    lastReadingAt: NOW,
    usedShare: 0.4,
    periodMs: null,
    projectedShare: 0.57,
    expectedWaste: 0.43,
    projectedLimitHitAt: null,
    basis: "measured",
    ...over,
  };
}

describe("format", () => {
  test("percent rounds to whole points", () => {
    expect(percent(0.427)).toBe("43%");
    expect(percent(0)).toBe("0%");
  });

  test("Pace line: waste ahead, max out day, untouched, no rate yet", () => {
    expect(paceText(pace(), NOW, TZ)).toBe("~43% waste ahead");
    expect(paceText(pace({ projectedLimitHitAt: "2026-10-06T09:00:00.000Z" }), NOW, TZ)).toBe("Max out Tue");
    expect(paceText(pace({ projectedLimitHitAt: "2026-10-05T20:00:00.000Z" }), NOW, TZ)).toBe("Max out today");
    expect(paceText(pace({ usedShare: 0 }), NOW, TZ)).toBe("Untouched");
    expect(paceText(pace({ expectedWaste: null, projectedShare: null }), NOW, TZ)).toBe("Needs more readings");
    expect(paceText(pace({ expectedWaste: 0.001 }), NOW, TZ)).toBe("Full use ahead");
  });

  test("days within the week as weekdays, later ones as dates, 24-hour times", () => {
    expect(weekdayOrDate("2026-10-07T10:00:00.000Z", NOW, TZ)).toBe("Wed");
    expect(weekdayOrDate("2026-10-20T10:00:00.000Z", NOW, TZ)).toBe("20 Oct");
    expect(resetText("2026-10-08T14:30:00.000Z", NOW, TZ)).toBe("Resets Thu 14:30");
    expect(resetText("2026-11-01T00:00:00.000Z", NOW, TZ)).toBe("Resets 1 Nov");
    expect(resetText(null, NOW, TZ)).toBe("No Reset reported");
  });

  test("delta vs the last Cycle in percentage points, ~ when Estimated", () => {
    expect(deltaPoints(0.4, 0.28)).toEqual({ points: 12, direction: "up", text: "+12 pts" });
    expect(deltaPoints(0.4, 0.43)).toEqual({ points: -3, direction: "down", text: "−3 pts" });
    expect(deltaPoints(0.4, 0.404).direction).toBe("flat");
    expect(deltaPoints(0.4, 0.2, "estimated").text).toBe("~+20 pts");
  });
});

describe("status and Provider identity", () => {
  test("every status has a label next to its color", () => {
    for (const s of ["green", "yellow", "red", "unknown"] as const) {
      expect(statusLook(s).label.length).toBeGreaterThan(0);
      expect(statusLook(s).color).toStartWith("var(--status-");
    }
  });

  test("Provider colors are fixed per Provider; unknown ones are neutral and sort last", () => {
    expect(providerColor("codex")).toBe("var(--provider-codex)");
    expect(providerColor("someone-new")).toBe("var(--provider-other)");
    expect(["zeta", "codex", "claude-work", "claude"].toSorted(byProviderOrder)).toEqual(["claude", "claude-work", "codex", "zeta"]);
  });
});

describe("plan tiles", () => {
  const running = (over: Partial<RunningCycle> = {}): RunningCycle => ({
    label: "Weekly",
    resetsAt: "2026-10-08T00:00:00.000Z",
    usedShare: 0.4,
    elapsedShare: 0.6,
    pace: pace(),
    status: "yellow",
    lastCycleAtSamePoint: { usedShare: 0.3, basis: "measured" },
    ...over,
  });
  const provider = (id: string, cycles: RunningCycle[]): ProviderOverview => ({
    provider: id,
    lastCycles: [],
    recentCycles: [],
    running: cycles,
    limitHits: { count: 0, blockedMs: 0, stillBlocked: false },
    overage: [],
  });

  test("one tile per Provider in the fixed order, with the delta vs the last Cycle", () => {
    const overview: Overview = {
      now: NOW,
      providers: [provider("codex", [running()]), provider("claude", [running({ lastCycleAtSamePoint: null })])],
    };
    const tiles = planTiles(overview);
    expect(tiles.map((t) => [t.key, t.name])).toEqual([
      ["claude", "Claude"],
      ["codex", "Codex"],
    ]);
    expect(tiles[0]!.delta).toBeNull();
    expect(tiles[1]!.delta?.text).toBe("+10 pts");
  });

  test("a Provider with two Cycle lines gets a tile each; one without a running Cycle still shows", () => {
    const overview: Overview = {
      now: NOW,
      providers: [provider("cursor", [running(), running({ label: "Premium" })]), provider("copilot", [])],
    };
    expect(planTiles(overview).map((t) => [t.key, t.name, t.running === null])).toEqual([
      ["cursor/Weekly", "Cursor Weekly", false],
      ["cursor/Premium", "Cursor Premium", false],
      ["copilot", "Copilot", true],
    ]);
  });
});
