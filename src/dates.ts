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
