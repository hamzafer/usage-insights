import { clock, dayMonth } from "./format";
import type { Basis } from "./types";

/**
 * Formatting for the Top sessions table (ticket #21): pure functions, tested with `bun test`.
 * Times use 24-hour clocks; `timeZone` defaults to the browser's.
 */

/** A share of a limit: "43%", "~5%" when Estimated, "<1%" for a sliver, "—" when unknown. */
export function limitText(share: number | null, basis: Basis | null): string {
  if (share === null || basis === null) return "—";
  const tilde = basis === "estimated" ? "~" : "";
  if (share > 0 && share < 0.005) return `${tilde}<1%`;
  return `${tilde}${Math.round(share * 100)}%`;
}

/** "7 Oct 09:05". */
export function sessionStart(iso: string, timeZone?: string): string {
  return `${dayMonth(iso, timeZone)} ${clock(iso, timeZone)}`;
}

/** From the first to the last call: "<1m", "42m", "2h 10m", "2d 1h". */
export function sessionDuration(from: string, to: string): string {
  const minutes = Math.floor((Date.parse(to) - Date.parse(from)) / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
