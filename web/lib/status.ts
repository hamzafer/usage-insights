import type { Status } from "./types";

/**
 * How a status shows: a dot in a status color plus a label, never the color alone. The rule that
 * picks the status lives on the server (src/pace-status.ts), shared with the Telegram card.
 * Status colors are reserved: never used for a Provider or a series.
 */
export interface StatusLook {
  label: string;
  /** CSS color of the dot. */
  color: string;
  /** What the status means, for a tooltip or screen reader. */
  description: string;
}

const LOOKS: Record<Status, StatusLook> = {
  green: {
    label: "On track",
    color: "var(--status-good)",
    description: "Heading for under 30% Waste, or maxing out only in the last tenth of the Cycle",
  },
  yellow: {
    label: "Watch",
    color: "var(--status-warning)",
    description: "Heading for 30–70% Waste, or a Limit Hit leaving up to 30% of the Cycle blocked",
  },
  red: {
    label: "Off track",
    color: "var(--status-critical)",
    description: "Heading for over 70% Waste, or a Limit Hit leaving more than 30% of the Cycle blocked",
  },
  unknown: {
    label: "No rate yet",
    color: "var(--status-unknown)",
    description: "Not enough readings in this Cycle to project its Pace",
  },
};

export function statusLook(status: Status): StatusLook {
  return LOOKS[status];
}

/** Worst first: red, yellow, green, unknown. */
export const STATUS_RANK: Record<Status, number> = { red: 0, yellow: 1, green: 2, unknown: 3 };
