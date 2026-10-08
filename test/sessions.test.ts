import { describe, expect, test } from "bun:test";
import { idleCapacity } from "../src/sessions.ts";
import { deriveWindows, type Reading } from "../src/window-model.ts";

function reading(label: "Weekly" | "Session", at: string, used: number, resetsAt: string | null): Reading {
  return {
    provider: "codex",
    label,
    role: label === "Weekly" ? "cycle" : "session",
    used,
    limit: 100,
    resetsAt,
    fetchedAt: at,
    source: "openusage",
  };
}
const weekly = (at: string, used: number, resetsAt: string | null) => reading("Weekly", at, used, resetsAt);
const session = (at: string, used: number, resetsAt: string | null) => reading("Session", at, used, resetsAt);

const HOUR = 3_600_000;
const NOW = "2026-10-10T00:00:00.000Z";

describe("Idle Capacity", () => {
  test("is the Cycle time no started Session covered; back-to-back Sessions leave no gap", () => {
    const windows = deriveWindows(
      [
        // Recorded every 5 minutes throughout, so every stretch is known.
        ...recorded("2026-10-01T09:00:00.000Z", "2026-10-08T08:50:00.000Z", { resetsAt: "2026-10-08T09:00:00.000Z", used: 0 }),
        weekly("2026-10-08T08:55:00.000Z", 50, "2026-10-08T09:00:00.000Z"),
        ...recorded("2026-10-08T09:05:00.000Z", NOW, { resetsAt: "2026-10-15T09:00:00.000Z", used: 0 }),
        // Session A 09:00-14:00, then B 14:00-19:00 right after it.
        session("2026-10-02T10:00:00.000Z", 30, "2026-10-02T14:00:00.000Z"),
        session("2026-10-02T15:00:00.000Z", 10, "2026-10-02T19:00:00.000Z"),
        // Unstarted: covers nothing.
        session("2026-10-03T12:00:00.000Z", 0, null),
        session("2026-10-04T12:00:00.000Z", 0, null),
      ],
      NOW,
    );

    const idle = idleCapacity(windows, NOW);

    expect(idle.map((i) => [i.cycle.endedAt, i.from, i.to, i.idleMs / HOUR])).toEqual([
      ["2026-10-08T09:00:00.000Z", "2026-10-01T09:00:00.000Z", "2026-10-08T09:00:00.000Z", 158],
      [null, "2026-10-08T09:00:00.000Z", NOW, 39],
    ]);
    expect(idle[0]!.share).toBeCloseTo(158 / 168);
    expect(idle[1]!.share).toBe(1);
    expect(idle.map((i) => i.unknownMs)).toEqual([0, 0]);
  });

  test("a running Session covers its Cycle up to now", () => {
    const now = "2026-10-08T12:00:00.000Z";
    const windows = deriveWindows(
      [
        ...recorded("2026-10-08T00:00:00.000Z", now),
        session("2026-10-08T11:00:00.000Z", 20, "2026-10-08T14:00:00.000Z"),
      ],
      now,
    );

    const [idle] = idleCapacity(windows, now);
    expect(idle!.idleMs / HOUR).toBe(9); // 00:00-09:00; the Session opened at 09:00 and is still open
  });

  test("a Provider without Sessions has no Idle Capacity", () => {
    const windows = deriveWindows(
      [{ ...weekly("2026-10-01T00:00:00.000Z", 10, "2026-10-19T10:00:00.000Z"), provider: "cursor", label: "Total usage" }],
      NOW,
    );
    expect(idleCapacity(windows, NOW)).toEqual([]);
  });
});

/** Weekly readings every `stepMin` minutes from `from` to `to` (inclusive), as a recorder takes them. */
function recorded(
  from: string,
  to: string,
  { resetsAt = "2026-10-15T00:00:00.000Z", used = 10, stepMin = 5 } = {},
): Reading[] {
  const out: Reading[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += stepMin * 60_000) {
    out.push(weekly(new Date(t).toISOString(), used, resetsAt));
  }
  return out;
}

describe("Idle Capacity across gaps", () => {
  const now = "2026-10-08T12:00:00.000Z";

  test("a stretch without readings is unknown, not idle", () => {
    const windows = deriveWindows(
      [
        ...recorded("2026-10-08T00:00:00.000Z", "2026-10-08T06:00:00.000Z"),
        // Nothing recorded 06:00-10:00.
        ...recorded("2026-10-08T10:00:00.000Z", "2026-10-08T12:00:00.000Z"),
        // A Session open 09:00-now: known busy time even where no reading was taken.
        session("2026-10-08T11:00:00.000Z", 20, "2026-10-08T14:00:00.000Z"),
      ],
      now,
    );

    const [idle] = idleCapacity(windows, now);
    expect(idle!.unknownMs / HOUR).toBe(3); // 06:00-09:00
    expect(idle!.idleMs / HOUR).toBe(6); // 00:00-06:00
    expect(idle!.share).toBe(0.5);
  });

  test("a recorder gap marker between two close readings makes that stretch unknown", () => {
    const windows = deriveWindows(
      [
        ...recorded("2026-10-08T00:00:00.000Z", "2026-10-08T12:00:00.000Z", { stepMin: 10 }),
        session("2026-10-08T11:00:00.000Z", 20, "2026-10-08T14:00:00.000Z"),
      ],
      now,
    );

    const [idle] = idleCapacity(windows, now, { gaps: [{ recordedAt: "2026-10-08T01:05:00.000Z" }] });
    expect(idle!.unknownMs / 60_000).toBe(10); // 01:00-01:10
    expect(idle!.idleMs / 60_000).toBe(9 * 60 - 10); // 00:00-09:00 less the gap
  });
});
