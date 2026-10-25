import type { ApiSpendWeek } from "./build.ts";

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

/**
 * API Spend money: `$0.04`; a non-zero amount under one cent is `<$0.01`. An unknown price (a model
 * without one in the price table) is never zero: `?` alone when nothing is known, else the known
 * part followed by `+?` (at least that much).
 */
export function apiMoney(costUsd: number, unknown: boolean): string {
  const known = costUsd > 0 && costUsd < 0.005 ? "<$0.01" : `$${costUsd.toFixed(2)}`;
  if (!unknown) return known;
  return costUsd > 0 ? `${known}+?` : "?";
}

/** `bouncer` is "Bouncer", `suggestions` "Suggestions"; any other Caller is capitalized as given. */
export function callerName(caller: string): string {
  return caller.charAt(0).toUpperCase() + caller.slice(1);
}

/**
 * The Report's API Spend line (plain text; the card escapes it):
 * `🔑 Claude API: $0.04 (personal: Bouncer $0.03, Suggestions $0.01; work: no calls)`.
 */
export function apiSpendLine(spend: ApiSpendWeek): string {
  const keys = spend.keys.map((k) => {
    const callers = k.callers.map((c) => `${callerName(c.caller)} ${apiMoney(c.costUsd, c.unknownCost)}`);
    return `${k.key}: ${callers.length ? callers.join(", ") : "no calls"}`;
  });
  return `🔑 Claude API: ${apiMoney(spend.costUsd, spend.unknownCost)} (${keys.join("; ")})`;
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
