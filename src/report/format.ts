/** Number, time and text formatting shared by the Markdown Report and the Telegram card. */

export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export function duration(durationMs: number): string {
  const minutes = Math.round(durationMs / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return [days && `${days}d`, hours && `${hours}h`, mins && `${mins}m`].filter(Boolean).join(" ") || "0m";
}

/** Overage keeps its own unit: dollars or credits, never a share of the allowance. */
export function amount(value: number, unit: string): string {
  return unit === "$" ? `$${value.toFixed(2)}` : `${Math.round(value * 100) / 100} ${unit}`;
}

/** "YYYY-MM-DD HH:MM" in the given (else the machine's) time zone. */
export function timeFormat(timeZone: string | undefined): (iso: string) => string {
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return (iso) => f.format(new Date(iso));
}

/** "YYYY-MM-DD" in the given (else the machine's) time zone. */
export function dayFormat(timeZone: string | undefined): (iso: string) => string {
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (iso) => f.format(new Date(iso));
}

/** Escapes text for Telegram's HTML parse mode (only &, < and > are special there). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Cuts text to at most `max` characters, ending with "…" when cut. The cut falls on a word boundary
 * (only a single word longer than half of `max` is cut inside), and trailing , ; : are dropped.
 */
export function clip(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  let cut = chars.slice(0, max - 1).join("");
  if (!/\s/.test(chars[max - 1]!)) {
    const lastSpace = cut.search(/\s\S*$/);
    if (lastSpace >= cut.length / 2) cut = cut.slice(0, lastSpace);
  }
  return `${cut.trimEnd().replace(/[,;:]+$/, "")}…`;
}
