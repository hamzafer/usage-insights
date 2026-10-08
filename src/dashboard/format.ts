import type { Waste } from "../window-model.ts";

export interface FormatOptions {
  /** IANA time zone; the machine's local zone when omitted. */
  timeZone?: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A share as a whole percent, "~" for Estimated (GLOSSARY: Measured vs Estimated). */
export function formatShare(waste: Pick<Waste, "share" | "basis"> | null): string {
  if (!waste) return "n/a";
  return `${waste.basis === "estimated" ? "~" : ""}${Math.round(waste.share * 100)}%`;
}

/** "8 Oct 14:05" (24-hour), or "8 Oct" with `date`. */
export function formatTime(iso: string, o: FormatOptions, form: "minute" | "date" = "minute"): string {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: o.timeZone,
    day: "numeric",
    month: "short",
    ...(form === "minute" ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}),
  });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return form === "minute" ? `${p.day} ${p.month} ${p.hour}:${p.minute}` : `${p.day} ${p.month}`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return [days && `${days}d`, hours && `${hours}h`, mins && `${mins}m`].filter(Boolean).join(" ") || "0m";
}

/** Overage keeps its own unit: dollars or credits, never a share of the allowance. */
export function formatAmount(amount: number, unit: string): string {
  if (unit === "$") return `$${amount.toFixed(2)}`;
  return `${Math.round(amount * 100) / 100} ${unit}`;
}
