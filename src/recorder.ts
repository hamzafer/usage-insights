import { classifyLine } from "./classify.ts";
import type { SnapshotSource } from "./snapshot-source.ts";
import type { Store, StoredReading } from "./store.ts";

export type RecordResult = { ok: true; stored: number } | { ok: false; reason: string };

/**
 * One recording run: fetch a Snapshot of every Provider and store each progress line with
 * its role. If the source fails, store a gap with the reason instead. Never throws for a
 * source failure, so a launchd loop keeps running.
 */
export async function record(
  source: SnapshotSource,
  store: Store,
  now: Date = new Date(),
): Promise<RecordResult> {
  const recordedAt = now.toISOString();
  let readings;
  try {
    readings = await source.fetch();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    store.saveGap({ recordedAt, reason });
    return { ok: false, reason };
  }

  const rows: StoredReading[] = readings.flatMap((reading) =>
    reading.lines.map((line) => ({
      provider: reading.providerId,
      label: line.label,
      role: classifyLine(reading.providerId, line.label),
      used: line.used,
      limit: line.limit,
      unit: line.unit,
      resetsAt: line.resetsAt,
      periodMs: line.periodMs,
      plan: reading.plan,
      fetchedAt: reading.fetchedAt,
      recordedAt,
    })),
  );
  return { ok: true, stored: store.saveReadings(rows) };
}
