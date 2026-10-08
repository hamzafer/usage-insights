import type { ProgressLine, ProviderReading, SnapshotSource } from "./snapshot-source.ts";

/** Reads Snapshots from OpenUsage's local API, `GET /v1/usage` (ADR 0001). */
export class OpenUsageSource implements SnapshotSource {
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async fetch(): Promise<ProviderReading[]> {
    const response = await fetch(this.url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new Error(`OpenUsage returned HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error("OpenUsage: unexpected response shape");
    return body.map(toReading);
  }
}

interface ApiCard {
  providerId: string;
  displayName: string;
  plan?: string | null;
  fetchedAt: string;
  lines?: ApiLine[];
}

interface ApiLine {
  type: string;
  label: string;
  used: number;
  limit: number;
  format?: { kind: string; suffix?: string };
  resetsAt?: string | null;
  periodDurationMs?: number | null;
}

function toReading(raw: unknown): ProviderReading {
  const card = raw as ApiCard;
  if (typeof card?.providerId !== "string" || typeof card.fetchedAt !== "string") {
    throw new Error("OpenUsage: unexpected response shape");
  }
  return {
    providerId: card.providerId,
    displayName: card.displayName,
    plan: card.plan ?? null,
    fetchedAt: card.fetchedAt,
    lines: (card.lines ?? []).filter((line) => line.type === "progress").map(toProgressLine),
  };
}

function toProgressLine(line: ApiLine): ProgressLine {
  return {
    label: line.label,
    used: line.used,
    limit: line.limit,
    unit: unitOf(line.format),
    resetsAt: line.resetsAt ?? null,
    periodMs: line.periodDurationMs ?? null,
  };
}

function unitOf(format: ApiLine["format"]): string {
  if (!format) return "unknown";
  if (format.kind === "count") return format.suffix ?? "count";
  return format.kind;
}
