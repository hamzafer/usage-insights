import { marker, percent } from "./format";
import { duration } from "./hero";
import { providerName } from "./providers";
import type { LastWeek } from "./types";

/**
 * The Overview's "Last week" row: Cycles that reset, Limit Hits and Overage, in the words of the
 * Telegram card's "✅ Last week" (src/report/card.ts). Pure, tested with `bun test`.
 */
export interface LastWeekLine {
  cycles: string[];
  limitHits: string;
  overage: string;
}

export function lastWeekLine(week: LastWeek): LastWeekLine {
  const labels = Map.groupBy(week.cycles, (c) => c.provider);
  const nameOf = (provider: string, label: string) =>
    new Set(labels.get(provider)!.map((c) => c.label)).size > 1 ? `${providerName(provider)} ${label}` : providerName(provider);

  const cycles = week.cycles.map((c) => {
    const reset = `${nameOf(c.provider, c.label)} reset ${c.resets}×`;
    if (c.waste === null || c.basis === null) return `${reset}, Waste unknown`;
    const tilde = marker(c.basis);
    let text = `${reset}, ${tilde}${percent(c.waste)} wasted`;
    if (c.previous !== null) {
      const now = Math.round(c.waste * 100);
      const before = Math.round(c.previous * 100);
      text += now === before ? " (same as before)" : ` (${now > before ? "↑" : "↓"} from ${tilde}${before}%)`;
    }
    return text;
  });

  const hits = week.limitHits;
  let limitHits = `${hits.count} Limit ${hits.count === 1 ? "Hit" : "Hits"}`;
  if (hits.previousAvg !== null) limitHits += ` (avg ${Math.round(hits.previousAvg * 10) / 10} a week)`;
  if (hits.count > 0) limitHits += `, blocked ${duration(hits.blockedMs)}`;

  return { cycles: cycles.length ? cycles : ["No Cycle reset"], limitHits, overage: overageText(week.overage) };
}

function overageText(overage: LastWeek["overage"]): string {
  const spent = overage.filter((o) => o.spent > 0);
  if (spent.length === 0) return "No Overage";
  const amounts = spent.map(({ unit, spent: sum }) => {
    const n = Number.isInteger(sum) ? String(sum) : String(Number(sum.toFixed(2)));
    return unit === "$" ? `$${n}` : `${n} ${unit}`;
  });
  return `${amounts.join(" + ")} Overage`;
}
