import { expect, test } from "bun:test";
import { dateParts } from "../src/dates.ts";

test("month and weekday names are fixed, not taken from the machine's ICU data (Sep, never Sept)", () => {
  const p = dateParts("2026-09-25T00:00:00Z", "UTC");
  expect(p).toEqual({ day: "25", month: "Sep", hour: "00", minute: "00", weekday: "Fri" });
});

test("the time zone decides the calendar day and weekday", () => {
  const p = dateParts("2026-10-08T23:30:00Z", "Europe/Oslo");
  expect(p).toEqual({ day: "9", month: "Oct", hour: "01", minute: "30", weekday: "Fri" });
});
