/**
 * The domain role of one progress line (spec: "Line classification").
 * - session / cycle / overage: analysed by the Window Model.
 * - submeter: stored, not analysed in v1 (Cursor Auto / API usage).
 * - ignored: stored, deliberately not analysed (Copilot Chat, unlimited).
 * - unclassified: a line nobody has mapped yet. Stored and surfaced, never dropped.
 */
export type LineRole =
  | "session"
  | "cycle"
  | "overage"
  | "submeter"
  | "ignored"
  | "unclassified";

/** Mapping table, keyed by OpenUsage providerId, then line label. */
const LINE_ROLES: Record<string, Record<string, LineRole>> = {
  claude: { Session: "session", Weekly: "cycle" },
  "claude-work": {
    Session: "session",
    Weekly: "cycle",
    "Extra usage spent": "overage",
  },
  codex: { Session: "session", Weekly: "cycle", "Workspace Credits": "overage" },
  cursor: {
    "Total usage": "cycle",
    "On-demand": "overage",
    "Auto usage": "submeter",
    "API usage": "submeter",
  },
  copilot: { Premium: "cycle", Chat: "ignored" },
};

export function classifyLine(providerId: string, label: string): LineRole {
  return LINE_ROLES[providerId]?.[label] ?? "unclassified";
}
