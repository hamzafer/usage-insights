import type { LineRole } from "./classify.ts";

/**
 * The Provider registry: everything known per Provider in one place (display name, line roles,
 * Overage units, whether past Waste is Estimated from tokens). Keyed by OpenUsage's providerId.
 * A Provider missing here still records: its lines are "unclassified" and its id shows as is.
 */

/** The `source` of readings from a live Snapshot (the Recorder), as opposed to `backfill:<provider>`. */
export const LIVE_SOURCE = "openusage";

export interface ProviderInfo {
  id: string;
  /** As OpenUsage shows it (its displayName). */
  displayName: string;
  /** Role per line label (spec: Line classification). */
  lines: Record<string, LineRole>;
  /** Unit per Overage line label: `$` or `credits`. */
  overageUnits: Record<string, string>;
  /**
   * True when the Provider's logs do not record its limit (Claude), so past Waste is Estimated from
   * tokens via a calibration (spec §4) and its Backfill readings are Estimated. Codex logs record the
   * limit: Measured.
   */
  calibrated: boolean;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: "claude",
    displayName: "Claude",
    lines: { Session: "session", Weekly: "cycle" },
    overageUnits: {},
    calibrated: true,
  },
  {
    id: "claude-work",
    displayName: "Claude (Work)",
    lines: { Session: "session", Weekly: "cycle", "Extra usage spent": "overage" },
    overageUnits: { "Extra usage spent": "$" },
    calibrated: true,
  },
  {
    id: "codex",
    displayName: "Codex",
    lines: { Session: "session", Weekly: "cycle", "Workspace Credits": "overage" },
    overageUnits: { "Workspace Credits": "credits" },
    calibrated: false,
  },
  {
    id: "cursor",
    displayName: "Cursor",
    lines: { "Total usage": "cycle", "On-demand": "overage", "Auto usage": "submeter", "API usage": "submeter" },
    overageUnits: { "On-demand": "$" },
    calibrated: false,
  },
  {
    id: "copilot",
    displayName: "Copilot",
    lines: { Premium: "cycle", Chat: "ignored" },
    overageUnits: {},
    calibrated: false,
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export function providerInfo(id: string): ProviderInfo | undefined {
  return BY_ID.get(id);
}

/** Providers whose past Waste is Estimated from tokens (Claude accounts). */
export const CALIBRATED_PROVIDER_IDS: readonly string[] = PROVIDERS.filter((p) => p.calibrated).map((p) => p.id);

export function isCalibrated(id: string): boolean {
  return providerInfo(id)?.calibrated ?? false;
}

/** A reading's basis from its source: a Backfill of a calibrated Provider is Estimated, the rest Measured. */
export function basisOfSource(source: string): "measured" | "estimated" {
  const backfill = /^backfill:(.+)$/.exec(source);
  return backfill && isCalibrated(backfill[1]!) ? "estimated" : "measured";
}
