import type { Store, StoredReading } from "./store.ts";

/** Plain-text status: the latest reading per Provider and line, then recent gaps. */
export function formatStatus(store: Store, gapLimit = 10): string {
  const out: string[] = [];
  const readings = store.latestReadings();

  if (readings.length === 0) {
    out.push("No Snapshots recorded yet.");
  } else {
    const byProvider = Map.groupBy(readings, (r) => r.provider);
    for (const [provider, lines] of byProvider) {
      const plan = lines[0]?.plan;
      out.push(plan ? `${provider} (${plan})` : provider);
      const labelWidth = Math.max(...lines.map((l) => l.label.length));
      for (const line of lines) out.push(`  ${formatLine(line, labelWidth)}`);
      out.push("");
    }
  }

  const gaps = store.recentGaps(gapLimit);
  if (gaps.length === 0) {
    out.push("No gaps recorded.");
  } else {
    out.push("Recent gaps");
    for (const gap of gaps) out.push(`  ${gap.recordedAt}  ${gap.reason}`);
  }
  return out.join("\n");
}

function formatLine(line: StoredReading, labelWidth: number): string {
  const amount = `${round(line.used)} / ${round(line.limit)} ${line.unit}`;
  const resets = line.resetsAt ? `resets ${line.resetsAt}` : "no reset";
  return [
    line.label.padEnd(labelWidth),
    line.role.padEnd(12),
    amount.padEnd(22),
    resets.padEnd(32),
    `fetched ${line.fetchedAt}`,
  ].join("  ");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
