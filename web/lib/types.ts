/**
 * Shapes of the JSON API (`src/dashboard/server.ts`, view models in `src/dashboard/view-model.ts`).
 * Kept by hand: the web app is a separate toolchain (ADR 0003). Times are ISO strings, shares 0..1.
 * Add a section's types here when its endpoint lands.
 */

export type Basis = "measured" | "estimated";

/** The status dot of a running Cycle, from Pace (src/pace-status.ts: same rule as the Telegram card). */
export type Status = "red" | "yellow" | "green" | "unknown";

export interface Waste {
  share: number;
  lastReadingAt: string;
  lowConfidence: boolean;
  basis: Basis;
}

export interface CycleResult {
  label: string;
  endedAt: string;
  waste: Waste | null;
}

export interface Pace {
  provider: string;
  label: string;
  resetsAt: string | null;
  lastReadingAt: string;
  usedShare: number;
  periodMs: number | null;
  projectedShare: number | null;
  expectedWaste: number | null;
  projectedLimitHitAt: string | null;
  basis: Basis;
}

export interface RunningCycle {
  label: string;
  resetsAt: string | null;
  usedShare: number;
  elapsedShare: number | null;
  pace: Pace;
  status: Status;
  /** The previous Cycle at the same point since its start; null when unknown. */
  lastCycleAtSamePoint: { usedShare: number; basis: Basis } | null;
}

export interface CycleOverage {
  cycleLabel: string;
  cycleEndedAt: string | null;
  overageLabel: string;
  unit: string;
  spent: number;
}

export interface ProviderOverview {
  provider: string;
  lastCycles: CycleResult[];
  recentCycles: CycleResult[];
  running: RunningCycle[];
  limitHits: { count: number; blockedMs: number; stillBlocked: boolean };
  overage: CycleOverage[];
}

/** `GET /api/overview` */
export interface Overview {
  now: string;
  providers: ProviderOverview[];
}

/** One row of `GET /api/sessions/top` (src/top-sessions.ts). */
export interface TopSession {
  provider: string;
  id: string;
  /** The main Project's folder name; "(other)" when none. */
  project: string;
  model: string;
  startedAt: string;
  endedAt: string;
  calls: number;
  tokens: number;
  /** Share of the 5-hour limit, 0..1 (can pass 1); null when unknown. */
  sessionShare: number | null;
  /** Share of the weekly limit, 0..1; null when unknown. */
  weeklyShare: number | null;
  /** Null when both shares are unknown (tokens only). */
  basis: Basis | null;
}

/** `GET /api/sessions/top?range=7d|30d` */
export interface TopSessions {
  now: string;
  range: string;
  sessions: TopSession[];
}
