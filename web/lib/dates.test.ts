import { describe, expect, test } from "bun:test";
import { compactNumber, dayKey, dayMonth, weekdayOrDate } from "./format";
import { longTime, tickLabel } from "./hero";
import { dayLabel, longDayLabel } from "./tokens";

// Synthetic values only. Month and weekday names are fixed, never the machine's ICU output.
const SEPT = "2026-09-25T10:00:00.000Z"; // a Friday

describe("dates use fixed English names (Sep, never Sept)", () => {
  test("dayMonth", () => {
    expect(dayMonth(SEPT, "UTC")).toBe("25 Sep");
  });

  test("weekdayOrDate within the week", () => {
    expect(weekdayOrDate(SEPT, "2026-09-23T10:00:00.000Z", "UTC")).toBe("Fri");
  });

  test("hero tick labels and the long time", () => {
    const span: [number, number] = [Date.parse("2026-09-20T00:00:00Z"), Date.parse("2026-09-27T00:00:00Z")];
    expect(tickLabel(Date.parse(SEPT), span, "UTC")).toBe("Fri 25");
    expect(longTime(SEPT, "UTC")).toBe("Fri 25 Sep, 10:00");
  });

  test("calendar day labels", () => {
    expect(dayLabel("2026-09-25")).toBe("25 Sep");
    expect(longDayLabel("2026-09-25")).toBe("Fri 25 Sep");
  });

  test("the time zone decides the calendar day", () => {
    expect(dayMonth("2026-10-08T23:30:00Z", "Europe/Oslo")).toBe("9 Oct");
    expect(weekdayOrDate("2026-10-08T23:30:00Z", "2026-10-06T12:00:00Z", "Europe/Oslo")).toBe("Fri");
  });
});

describe("dayKey", () => {
  test("YYYY-MM-DD in the given time zone", () => {
    expect(dayKey(SEPT, "UTC")).toBe("2026-09-25");
    expect(dayKey("2026-10-08T23:30:00Z", "Europe/Oslo")).toBe("2026-10-09");
    expect(dayKey("2026-01-05T03:00:00Z", "UTC")).toBe("2026-01-05");
  });
});

describe("compactNumber", () => {
  test("K, M and B with at most one decimal", () => {
    expect(compactNumber(0)).toBe("0");
    expect(compactNumber(950)).toBe("950");
    expect(compactNumber(12_300)).toBe("12.3K");
    expect(compactNumber(120_400)).toBe("120K");
    expect(compactNumber(2_000_000)).toBe("2M");
    expect(compactNumber(30_817_200)).toBe("30.8M");
    expect(compactNumber(1_250_000_000)).toBe("1.3B");
    expect(compactNumber(2_400_000_000)).toBe("2.4B");
  });
});
