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

/** A Limit Hit inside a Cycle (of the Cycle itself or a Session in it). */
export interface HistoryLimitHit {
  role: "session" | "cycle";
  label: string;
  hitAt: string;
  /** Blocked Time in ms; while still blocked, the time so far. */
  blockedMs: number;
  blockedUntil: string | null;
  endedBy: "reset" | "overage" | "running";
}

/** One Cycle of the Waste and Limit history (src/dashboard/history.ts). */
export interface HistoryCycle {
  label: string;
  /** Its start (the previous Reset); null when unknown. */
  from: string | null;
  /** When it ended, or when it is due while running. */
  resetAt: string | null;
  running: boolean;
  usedShare: number;
  /** Null while running. */
  wasteShare: number | null;
  basis: Basis;
  lowConfidence: boolean;
  /** Estimated from tokens: the Cycle's dates were stepped or assumed. */
  inferred: boolean;
  limitHits: HistoryLimitHit[];
}

/** `GET /api/history/:provider` */
export interface CycleHistory {
  provider: string;
  /** Oldest first; the running Cycle last. */
  cycles: HistoryCycle[];
}

/** One local day of `GET /api/tokens/daily`: tokens per Provider, then per model id (absent when 0). */
export interface TokensDay {
  /** `YYYY-MM-DD`, the server's local calendar day. */
  date: string;
  byProvider: Record<string, Record<string, number>>;
}

/** `GET /api/tokens/daily?range=7d|30d` */
export interface TokensDaily {
  range: "7d" | "30d";
  /** Oldest first, today last; days without tokens included (logs: no events is truly 0). */
  days: TokensDay[];
  /** Models with tokens in the last 30 days, largest first in every range: the stable color order. */
  models: { id: string; name: string }[];
  /** Providers with tokens in the last 30 days. */
  providers: string[];
}

/** A ranked row of `GET /api/projects?range=`: a Project's folder name or a model id. */
export interface RankedShare {
  name: string;
  /** What a person reads: the folder name, or the friendly model name ("Opus 5.5"). */
  label: string;
  tokens: number;
  /** Of the Provider's total in the range, 0..1. */
  share: number;
}

export interface ProviderRanking {
  provider: string;
  total: number;
  /** Largest first. */
  projects: RankedShare[];
  models: RankedShare[];
}

/** `GET /api/projects?range=7d|30d`: every Provider with token logs (total 0 when quiet in the range). */
export interface ProjectsRange {
  range: "7d" | "30d";
  from: string;
  to: string;
  providers: ProviderRanking[];
}

/** One reading in the hero chart: share of the allowance used at a time. */
export interface HeroPoint {
  at: string;
  usedShare: number;
  basis: Basis;
}

/** `GET /api/hero/:provider` (src/dashboard/hero.ts): one plan's current Cycle. */
export interface HeroCycle {
  provider: string;
  label: string;
  /** Every Cycle line of the Provider (pick one with `?label=`). */
  labels: string[];
  running: boolean;
  /** The Cycle's start (the previous Reset); null while unknown. */
  start: string | null;
  resetsAt: string | null;
  endedAt: string | null;
  limitShare: 1;
  readings: HeroPoint[];
  /** The projection from the newest reading to the Reset; null while ended or without a rate yet. */
  pace: {
    points: { at: string; usedShare: number }[];
    projectedShare: number;
    expectedWaste: number;
    projectedLimitHitAt: string | null;
    basis: Basis;
  } | null;
  /** Stretches without readings: drawn as breaks, never as zero. */
  gaps: { from: string; to: string }[];
}
