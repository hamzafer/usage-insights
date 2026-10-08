import type { Waste, Window } from "./window-model.ts";

export interface SummaryOptions {
  /** IANA time zone for Reset times; the machine's local zone when omitted. */
  timeZone?: string;
}

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
