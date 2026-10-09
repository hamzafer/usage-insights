import { expect, test } from "bun:test";
import { limitText, sessionDuration, sessionStart } from "./top-sessions";

// Top sessions table formatting (ticket #21). Synthetic values only.

test("limit shares: Measured plain, Estimated with ~, unknown as a dash", () => {
  expect(limitText(0.427, "measured")).toBe("43%");
  expect(limitText(0.05, "estimated")).toBe("~5%");
  expect(limitText(1.3, "measured")).toBe("130%");
  expect(limitText(0.003, "measured")).toBe("<1%");
  expect(limitText(0, "measured")).toBe("0%");
  expect(limitText(null, "measured")).toBe("—");
  expect(limitText(null, null)).toBe("—");
});

test("when a session started, in 24-hour time", () => {
  expect(sessionStart("2026-10-07T09:05:00.000Z", "UTC")).toBe("7 Oct 09:05");
});

test("how long a session ran", () => {
  expect(sessionDuration("2026-10-07T09:00:00.000Z", "2026-10-07T09:00:30.000Z")).toBe("<1m");
  expect(sessionDuration("2026-10-07T09:00:00.000Z", "2026-10-07T09:42:00.000Z")).toBe("42m");
  expect(sessionDuration("2026-10-07T09:00:00.000Z", "2026-10-07T11:10:00.000Z")).toBe("2h 10m");
  expect(sessionDuration("2026-10-07T09:00:00.000Z", "2026-10-09T10:00:00.000Z")).toBe("2d 1h");
});
