import { providerInfo } from "./providers.ts";

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

/** The line's role from the Provider registry (src/providers.ts), keyed by providerId then label. */
export function classifyLine(providerId: string, label: string): LineRole {
  return providerInfo(providerId)?.lines[label] ?? "unclassified";
}
