/**
 * The seam Snapshots come through (ADR 0001). Today the only implementation reads
 * OpenUsage's local API; own logins per Provider would be another implementation.
 */
export interface SnapshotSource {
  /** One reading per Provider. Throws when the source is unreachable or unreadable. */
  fetch(): Promise<ProviderReading[]>;
}

/** One Provider's usage at one moment: the raw material of a Snapshot. */
export interface ProviderReading {
  providerId: string;
  displayName: string;
  plan: string | null;
  /** When the source read the Provider (ISO 8601). */
  fetchedAt: string;
  /** Progress lines only; text and chart lines never cross the seam. */
  lines: ProgressLine[];
}

export interface ProgressLine {
  label: string;
  used: number;
  limit: number;
  /** "percent", "dollars", or a count suffix such as "credits". */
  unit: string;
  resetsAt: string | null;
  periodMs: number | null;
}
