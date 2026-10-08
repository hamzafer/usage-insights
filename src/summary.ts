import { idleCapacity, type IdleCapacityOptions } from "./sessions.ts";
import type { CycleTokens, Share } from "./token-shares.ts";
import type { Waste, Window } from "./window-model.ts";

export interface SummaryOptions {
  /** IANA time zone for Reset times; the machine's local zone when omitted. */
  timeZone?: string;
}

/** Recorder gap markers make the time around them unknown rather than Idle Capacity. */
export interface SessionsOptions extends SummaryOptions, IdleCapacityOptions {}

/** Plain-text list of ended Cycles per Provider with their Waste (`bun run summary`). */
export function formatSummary(windows: readonly Window[], options: SummaryOptions = {}): string {
  const ended = windows.filter((w) => w.role === "cycle" && w.endedAt);
  if (ended.length === 0) return "No ended Cycles yet.";

  const time = new Intl.DateTimeFormat("sv-SE", {
    timeZone: options.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const out: string[] = [];
  for (const [provider, cycles] of Map.groupBy(ended, (w) => w.provider)) {
    if (out.length) out.push("");
    out.push(provider);
    const labelWidth = Math.max(...cycles.map((c) => c.label.length));
    for (const c of cycles) {
      const parts = [c.label.padEnd(labelWidth), `reset ${time.format(new Date(c.endedAt!))}`, formatWaste(c.waste)];
      if (c.waste?.lowConfidence) {
        parts.push(`low confidence: last reading ${formatGap(c.waste.lastReadingAt, c.endedAt!)} before Reset`);
      }
      out.push(`  ${parts.join("  ")}`);
    }
  }
  return out.join("\n");
}

/** Estimated figures are always marked "~" (GLOSSARY: Measured vs Estimated). */
function formatWaste(waste: Waste | null): string {
  if (!waste) return "Waste  n/a";
  const marker = waste.basis === "estimated" ? "~" : " ";
  return `Waste ${marker}${`${Math.round(waste.share * 100)}%`.padStart(3)}`;
}

function formatGap(from: string, to: string): string {
  const minutes = Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return [days && `${days}d`, hours && `${hours}h`, mins && `${mins}m`].filter(Boolean).join(" ") || "0m";
}

/**
 * Plain-text Sessions section (`bun run summary`): Waste for every started Session that ended,
 * then Idle Capacity per Cycle, per Provider, with the Cycle's unknown (gap) time when it has any.
 * Empty when no Session line was recorded. `windows` must hold both the Sessions and the Cycles.
 */
export function formatSessions(windows: readonly Window[], now: string | Date, options: SessionsOptions = {}): string {
  const providers = [...new Set(windows.filter((w) => w.role === "session").map((w) => w.provider))];
  if (providers.length === 0) return "";

  const idle = idleCapacity(windows, now, options);
  const time = minuteFormat(options.timeZone);
  const out = ["Sessions"];
  for (const provider of providers) {
    out.push(provider);
    const ended = windows.filter((w) => w.provider === provider && w.role === "session" && w.endedAt && w.waste);
    for (const s of ended) {
      const parts = [s.label, `reset ${time.format(new Date(s.endedAt!))}`, formatWaste(s.waste)];
      if (s.waste!.lowConfidence) {
        parts.push(`low confidence: last reading ${formatGap(s.waste!.lastReadingAt, s.endedAt!)} before Reset`);
      }
      out.push(`  ${parts.join("  ")}`);
    }
    for (const i of idle.filter((i) => i.provider === provider)) {
      const when = i.cycle.endedAt ? `reset ${time.format(new Date(i.cycle.endedAt))}` : "running so far";
      const duration = formatGap(i.from, new Date(Date.parse(i.from) + i.idleMs).toISOString());
      const share = `${Math.round(i.share * 100)}%`.padStart(3);
      const unknown = i.unknownMs > 0 ? `  unknown ${formatGap(i.from, new Date(Date.parse(i.from) + i.unknownMs).toISOString())}` : "";
      out.push(`  Idle Capacity  ${i.cycle.label}  ${when.padEnd(22)}  ${duration}  ${share}${unknown}`);
    }
  }
  return out.join("\n");
}

/** How many Cycles per Provider the token section lists, newest last. */
export const SUMMARY_TOKEN_CYCLES = 2;
/** Projects and models named per line; the rest are summed as "N more". */
export const SUMMARY_TOP_SHARES = 5;

/**
 * Plain-text Projects and models section (`bun run summary`): the last Cycles per Provider with
 * their token share per Project and per model. Empty without token data.
 */
export function formatTokenShares(cycles: readonly CycleTokens[], options: SummaryOptions = {}): string {
  if (cycles.length === 0) return "";
  const time = minuteFormat(options.timeZone);
  const out = ["Projects and models (token share per Cycle)"];
  for (const [provider, own] of Map.groupBy(cycles, (c) => c.provider)) {
    out.push(provider);
    for (const c of own.slice(-SUMMARY_TOKEN_CYCLES)) {
      const span = `${time.format(new Date(c.from))} to ${time.format(new Date(c.to))}`;
      const notes = [c.running && "running", c.inferred && "Cycle inferred"].filter(Boolean).join(", ");
      out.push(`  ${[c.label, span, `${formatTokens(c.total)} tokens`, notes].filter(Boolean).join("  ")}`);
      out.push(`    Projects  ${formatShares(c.byProject)}`);
      out.push(`    Models    ${formatShares(c.byModel)}`);
    }
  }
  return out.join("\n");
}

function formatShares(shares: readonly Share[]): string {
  const percent = (s: number) => `${Math.round(s * 100)}%`;
  const named = shares.slice(0, SUMMARY_TOP_SHARES).map((s) => `${s.name} ${percent(s.share)}`);
  const rest = shares.slice(SUMMARY_TOP_SHARES);
  if (rest.length) named.push(`${rest.length} more ${percent(rest.reduce((sum, s) => sum + s.share, 0))}`);
  return named.join(", ");
}

/** 400, 7k, 1.3M, 2.1B. */
export function formatTokens(n: number): string {
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  for (const [size, suffix] of units) {
    if (n >= size) return `${Number((n / size).toFixed(n >= size * 10 ? 0 : 1))}${suffix}`;
  }
  return String(Math.round(n));
}

function minuteFormat(timeZone: string | undefined): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}
