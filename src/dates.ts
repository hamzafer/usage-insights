// Month and weekday names are fixed here instead of taken from Intl: ICU versions disagree
// ("Sep" vs "Sept"), which made output differ between machines and broke CI.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface DateParts {
  day: string;
  month: string;
  hour: string;
  minute: string;
  weekday: string;
}

/** Day, short month, 24-hour time and short weekday of `iso` in `timeZone` (local when omitted). */
export function dateParts(iso: string, timeZone?: string): DateParts {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const weekday = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))).getUTCDay();
  return {
    day: String(Number(p.day)),
    month: MONTHS[Number(p.month) - 1]!,
    hour: p.hour!,
    minute: p.minute!,
    weekday: WEEKDAYS[weekday]!,
  };
}

const DAY_MS = 24 * 3_600_000;

/** `YYYY-MM-DD` of a time in `timeZone` (local when omitted). */
export function localDay(timeZone?: string): (ms: number) => string {
  const f = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  return (ms) => {
    const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
}

/** The `count` calendar days ending with `today`, oldest first (calendar math, so DST cannot skip a day). */
export function lastDays(today: string, count: number): string[] {
  const base = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(base - (count - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}
