/**
 * The one place the web app turns an instant into calendar parts. Month and weekday names are
 * fixed here instead of taken from Intl: ICU versions disagree ("Sep" vs "Sept"), which made output
 * differ between machines (as in src/dates.ts). Intl is used for numeric parts only.
 */

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface DateParts {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  /** "00" to "23". */
  hour: string;
  /** "00" to "59". */
  minute: string;
  /** "Sep". */
  monthName: string;
  /** "Fri". */
  weekday: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function numericFormat(timeZone?: string): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(key, f);
  }
  return f;
}

/** Calendar parts of `at` (ISO string or epoch ms) in `timeZone` (the browser's when omitted). */
export function dateParts(at: string | number, timeZone?: string): DateParts {
  const ms = typeof at === "string" ? Date.parse(at) : at;
  const p = Object.fromEntries(numericFormat(timeZone).formatToParts(ms).map((x) => [x.type, x.value]));
  const year = Number(p.year);
  const month = Number(p.month);
  const day = Number(p.day);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return {
    year,
    month,
    day,
    hour: p.hour!,
    minute: p.minute!,
    monthName: MONTHS[month - 1]!,
    weekday: WEEKDAYS[weekday]!,
  };
}
