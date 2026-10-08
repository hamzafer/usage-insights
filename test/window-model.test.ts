import { describe, expect, test } from "bun:test";
import { deriveWindows, type Reading } from "../src/window-model.ts";

// Hand-built reading sequences. `at` is a fetch time; resets are given exactly as OpenUsage
// would report them (with jitter where a test says so).
function reading(at: string, used: number, resetsAt: string | null, over: Partial<Reading> = {}): Reading {
  return {
    provider: "codex",
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

const NOW = "2026-10-10T00:00:00.000Z";

describe("Cycle Waste", () => {
  test("a Cycle that reset has Waste from its last reading before the Reset", () => {
    const windows = deriveWindows(
      [
        reading("2026-10-01T10:00:00.000Z", 10, "2026-10-08T09:00:00.000Z"),
        reading("2026-10-08T08:55:00.000Z", 70, "2026-10-08T09:00:00.000Z"),
        reading("2026-10-08T09:05:00.000Z", 0, "2026-10-15T09:00:00.000Z"),
      ],
      NOW,
    );

    expect(windows).toHaveLength(2);
    const [ended, running] = windows;
    expect(ended!.endedAt).toBe("2026-10-08T09:00:00.000Z");
    expect(ended!.waste).toEqual({
      share: 0.3,
      lastReadingAt: "2026-10-08T08:55:00.000Z",
      lowConfidence: false,
      basis: "measured",
    });
    expect(running!.endedAt).toBeNull();
    expect(running!.waste).toBeNull();
  });

  test("reset-time jitter and seconds of drift keep readings in one Cycle", () => {
    const windows = deriveWindows(
      [
        reading("2026-10-01T10:00:00.000Z", 10, "2026-10-08T08:59:59.981Z"),
        reading("2026-10-02T10:00:00.000Z", 20, "2026-10-08T09:00:00.412Z"),
        reading("2026-10-03T10:00:00.000Z", 30, "2026-10-08T09:00:07.000Z"),
        reading("2026-10-04T10:00:00.000Z", 40, "2026-10-08T08:59:52.000Z"),
      ],
      "2026-10-05T00:00:00.000Z",
    );

    expect(windows).toHaveLength(1);
    expect(windows[0]!.resetsAt).toBe("2026-10-08T09:00:00.000Z");
    expect(windows[0]!.readings).toHaveLength(4);
  });

  test("Waste is low confidence when the last reading is more than 30 minutes before the Reset", () => {
    const at = (lastAt: string) =>
      deriveWindows(
        [
          reading(lastAt, 60, "2026-10-08T09:00:00.000Z"),
          reading("2026-10-08T12:00:00.000Z", 5, "2026-10-15T09:00:00.000Z"),
        ],
        NOW,
      )[0]!.waste;

    expect(at("2026-10-08T08:30:00.000Z")!.lowConfidence).toBe(false);
    expect(at("2026-10-08T08:29:00.000Z")).toEqual({
      share: 0.4,
      lastReadingAt: "2026-10-08T08:29:00.000Z",
      lowConfidence: true,
      basis: "measured",
    });
  });

  test("usage dropping back near zero is a Reset even without a reported reset time", () => {
    const windows = deriveWindows(
      [
        reading("2026-10-08T08:00:00.000Z", 50, null),
        reading("2026-10-08T08:55:00.000Z", 80, null),
        reading("2026-10-08T09:05:00.000Z", 0.5, null),
        reading("2026-10-08T10:00:00.000Z", 4, null),
      ],
      NOW,
    );

    expect(windows.map((w) => w.readings.length)).toEqual([2, 2]);
    // The Reset happened somewhere in the gap; the first reading after it bounds it.
    expect(windows[0]!.endedAt).toBe("2026-10-08T09:05:00.000Z");
    expect(windows[0]!.waste).toMatchObject({ share: 0.2, lowConfidence: false });
    expect(windows[1]!.endedAt).toBeNull();
  });

  test("small dips in usage are not a Reset", () => {
    const windows = deriveWindows(
      [
        reading("2026-10-08T08:00:00.000Z", 3, "2026-10-15T09:00:00.000Z"),
        reading("2026-10-08T09:00:00.000Z", 1, "2026-10-15T09:00:00.000Z"),
        reading("2026-10-08T10:00:00.000Z", 40, "2026-10-15T09:00:00.000Z"),
        reading("2026-10-08T11:00:00.000Z", 38, "2026-10-15T09:00:00.000Z"),
      ],
      "2026-10-09T00:00:00.000Z",
    );

    expect(windows).toHaveLength(1);
  });

  test("a Cycle whose Reset has passed is ended even with no reading after it", () => {
    const readings = [
      reading("2026-10-07T09:00:00.000Z", 20, "2026-10-08T09:00:00.000Z"),
      reading("2026-10-08T07:00:00.000Z", 90, "2026-10-08T09:00:00.000Z"),
    ];

    expect(deriveWindows(readings, "2026-10-08T08:59:00.000Z")[0]!.endedAt).toBeNull();
    const [ended] = deriveWindows(readings, "2026-10-08T09:00:00.000Z");
    expect(ended!.endedAt).toBe("2026-10-08T09:00:00.000Z");
    expect(ended!.waste).toMatchObject({ share: 0.1, lowConfidence: true });
  });

  test("a reading fetched after the Reset starts a new Cycle even if it reports no reset time", () => {
    const windows = deriveWindows(
      [
        reading("2026-10-08T08:50:00.000Z", 0, "2026-10-08T09:00:00.000Z"),
        reading("2026-10-08T09:10:00.000Z", 0, null),
      ],
      NOW,
    );

    expect(windows).toHaveLength(2);
    expect(windows[0]!.waste).toMatchObject({ share: 1, lowConfidence: false });
  });
});

describe("lines", () => {
  test("each Provider and line gets its own Windows, sorted by Provider, line, then time", () => {
    const windows = deriveWindows(
      [
        reading("2026-10-08T10:00:00.000Z", 0, "2026-10-15T09:00:00.000Z", { provider: "claude" }),
        reading("2026-10-08T08:00:00.000Z", 75, "2026-10-08T09:00:00.000Z", { provider: "claude" }),
        reading("2026-10-08T08:00:00.000Z", 10, "2026-10-08T12:00:00.000Z", {
          provider: "claude",
          label: "Session",
          role: "session",
        }),
        reading("2026-10-08T08:40:00.000Z", 50, "2026-10-08T09:00:00.000Z"),
      ],
      "2026-10-08T10:00:00.000Z",
    );

    const summary = windows.map((w) => [w.provider, w.label, w.role, w.endedAt, w.waste?.share ?? null]);
    expect(summary).toEqual([
      ["claude", "Session", "session", null, null],
      ["claude", "Weekly", "cycle", "2026-10-08T09:00:00.000Z", 0.25],
      ["claude", "Weekly", "cycle", null, null],
      ["codex", "Weekly", "cycle", "2026-10-08T09:00:00.000Z", 0.5],
    ]);
  });
});

describe("Waste edge cases", () => {
  const ended = (over: Partial<Reading>) =>
    deriveWindows(
      [
        reading("2026-10-08T08:50:00.000Z", 30, "2026-10-08T09:00:00.000Z", over),
        reading("2026-10-08T09:10:00.000Z", 0, "2026-10-15T09:00:00.000Z", over),
      ],
      NOW,
    )[0]!;

  test("Waste from a Claude Backfill reading is Estimated, any other source is Measured", () => {
    expect(ended({ source: "backfill:claude" }).waste!.basis).toBe("estimated");
    expect(ended({ source: "backfill:codex" }).waste!.basis).toBe("measured");
  });

  test("a stale reading fetched after the Reset is not the one Waste comes from", () => {
    const windows = deriveWindows(
      [
        reading("2026-10-08T08:50:00.000Z", 30, "2026-10-08T09:00:00.000Z"),
        reading("2026-10-08T09:20:00.000Z", 30, "2026-10-08T09:00:00.000Z"),
        reading("2026-10-08T09:25:00.000Z", 1, "2026-10-15T09:00:00.000Z"),
      ],
      NOW,
    );

    expect(windows).toHaveLength(2);
    expect(windows[0]!.waste).toMatchObject({ share: 0.7, lastReadingAt: "2026-10-08T08:50:00.000Z" });
  });

  test("a line with no limit has no Waste", () => {
    const window = ended({ limit: 0, used: 0 });
    expect(window.endedAt).toBe("2026-10-08T09:00:00.000Z");
    expect(window.waste).toBeNull();
  });
});

describe("Session Waste", () => {
  const session = (at: string, used: number, resetsAt: string | null) =>
    reading(at, used, resetsAt, { label: "Session", role: "session" });

  test("a started Session has Waste; an unstarted one (no usage, no reset time) has none", () => {
    const windows = deriveWindows(
      [
        session("2026-10-08T10:00:00.000Z", 20, "2026-10-08T14:00:00.250Z"),
        session("2026-10-08T13:50:00.000Z", 60, "2026-10-08T14:00:00.250Z"),
        session("2026-10-08T14:30:00.000Z", 0, null),
        session("2026-10-08T15:30:00.000Z", 0, null),
        session("2026-10-08T16:10:00.000Z", 5, "2026-10-08T21:00:00.000Z"),
      ],
      NOW,
    );

    expect(windows.map((w) => [w.readings.length, w.endedAt])).toEqual([
      [2, "2026-10-08T14:00:00.000Z"],
      [2, "2026-10-08T16:10:00.000Z"],
      [1, "2026-10-08T21:00:00.000Z"],
    ]);
    expect(windows[0]!.waste?.share).toBe(0.4);
    expect(windows[1]!.waste).toBeNull();
    expect(windows[2]!.waste?.share).toBe(0.95);
  });
});

describe("flip-flopping Resets", () => {
  // Shape of the real Codex Backfill case: an early Reset at 14:10, then readings that bounce
  // between two Reset times 17 minutes apart (with different usage) before settling.
  const B = "2026-09-14T14:10:11.000Z";
  const C = "2026-09-14T14:27:26.000Z";

  test("readings alternating between two Reset times minutes apart stay one Cycle", () => {
    const windows = deriveWindows(
      [
        reading("2026-09-07T14:00:00.000Z", 82, "2026-09-09T11:47:35.000Z"),
        reading("2026-09-07T14:10:10.000Z", 0, B),
        reading("2026-09-07T14:11:39.000Z", 2, B),
        reading("2026-09-07T14:11:56.000Z", 7, C),
        reading("2026-09-07T14:12:00.000Z", 2, B),
        reading("2026-09-07T14:26:53.000Z", 16, B),
        reading("2026-09-07T14:27:29.000Z", 0, C),
        reading("2026-09-07T14:57:30.000Z", 12, C),
        reading("2026-09-08T10:00:00.000Z", 30, C),
      ],
      "2026-09-08T12:00:00.000Z",
    );

    expect(windows.map((w) => [w.readings.length, w.endedAt])).toEqual([
      [1, "2026-09-07T14:10:10.000Z"],
      [8, null],
    ]);
    // The Reset the readings settled on.
    expect(windows[1]!.resetsAt).toBe("2026-09-14T14:27:00.000Z");
  });

  test("a genuine early Reset (usage drops and the new Reset sticks) still starts a new Cycle", () => {
    const windows = deriveWindows(
      [
        reading("2026-09-07T10:00:00.000Z", 40, "2026-09-10T09:00:00.000Z"),
        reading("2026-09-07T14:00:00.000Z", 82, "2026-09-10T09:00:00.000Z"),
        reading("2026-09-07T14:10:00.000Z", 0, "2026-09-14T14:10:00.000Z"),
        reading("2026-09-07T14:15:00.000Z", 1, "2026-09-14T14:10:00.000Z"),
        reading("2026-09-08T10:00:00.000Z", 20, "2026-09-14T14:10:00.000Z"),
      ],
      "2026-09-08T12:00:00.000Z",
    );

    expect(windows.map((w) => [w.readings.length, w.endedAt])).toEqual([
      [2, "2026-09-07T14:10:00.000Z"],
      [3, null],
    ]);
    expect(windows[0]!.waste).toMatchObject({ share: 0.18 });
  });
});
