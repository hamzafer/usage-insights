import { describe, expect, test } from "bun:test";
import { lastWeekLine } from "./last-week";
import type { LastWeek } from "./types";

// Synthetic values only.
function week(over: Partial<LastWeek> = {}): LastWeek {
  return {
    from: "2026-10-05T09:00:00.000Z",
    to: "2026-10-12T09:00:00.000Z",
    cycles: [{ provider: "codex", label: "Weekly", resets: 1, basis: "measured", waste: 0.2, previous: 0.4 }],
    limitHits: { count: 1, previousAvg: 0, blockedMs: 2 * 3_600_000 },
    overage: [{ unit: "$", spent: 15 }],
    ...over,
  };
}

describe("lastWeekLine", () => {
  test("Cycles that reset, Limit Hits and Overage with friendly names", () => {
    expect(lastWeekLine(week())).toEqual({
      cycles: ["Codex reset 1×, 20% wasted (↓ from 40%)"],
      limitHits: "1 Limit Hit (avg 0 a week), blocked 2h",
      overage: "$15 Overage",
    });
  });

  test("Estimated Waste carries ~, an unmeasured one says so, a line name only when a Provider has two", () => {
    const line = lastWeekLine(
      week({
        cycles: [
          { provider: "claude", label: "Weekly", resets: 1, basis: "estimated", waste: 0.35, previous: 0.35 },
          { provider: "claude", label: "Weekly Opus", resets: 2, basis: null, waste: null, previous: null },
        ],
      }),
    );
    expect(line.cycles).toEqual(["Claude Weekly reset 1×, ~35% wasted (same as before)", "Claude Weekly Opus reset 2×, Waste unknown"]);
  });

  test("a quiet week", () => {
    expect(lastWeekLine(week({ cycles: [], limitHits: { count: 0, previousAvg: null, blockedMs: 0 }, overage: [] }))).toEqual({
      cycles: ["No Cycle reset"],
      limitHits: "0 Limit Hits",
      overage: "No Overage",
    });
  });

  test("Overage in credits keeps its unit; nothing spent reads as none", () => {
    expect(lastWeekLine(week({ overage: [{ unit: "credits", spent: 12.5 }] })).overage).toBe("12.5 credits Overage");
    expect(lastWeekLine(week({ overage: [{ unit: "$", spent: 0 }] })).overage).toBe("No Overage");
  });
});
