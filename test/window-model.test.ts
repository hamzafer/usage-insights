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

const NOW = "2026-10-20T00:00:00.000Z";

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
});
