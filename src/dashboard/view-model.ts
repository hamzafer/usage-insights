import { type Calibration, claudeCalibration, type EstimatedWaste } from "../calibration.ts";
import { limitsOverageAndPace } from "../limits-summary.ts";
import type { CycleOverage } from "../overage.ts";
import type { Pace } from "../pace.ts";
import { idleCapacity, READING_GAP_TOLERANCE_MS } from "../sessions.ts";
import type { Gap, RunOutcome, StoredReading, TokenEvent } from "../store.ts";
import { type CycleTokens, tokensByCycle } from "../token-shares.ts";
import { deriveWindows, type Reading, type Waste, type Window } from "../window-model.ts";

/**
 * Dashboard view models (spec §5): pure functions turning stored data into page data.
 * No I/O and no HTML here, so the data layer stays separate from rendering (ADR 0002).
 */

/** Everything the dashboard reads from the store for one request. */
export interface DashboardData {
  /** Readings of every role and source. */
  readings: Reading[];
  /** The newest reading of every line. */
  latest: StoredReading[];
  /** Every recorder gap, oldest first. */
  gaps: Gap[];
  /** Token events from the token Backfill, oldest first; none when omitted. */
  tokens?: TokenEvent[];
  /** The newest Backfill and Report run outcomes, newest first; none when omitted. */
  runs?: RunOutcome[];
}

export interface CycleResult {
  label: string;
  endedAt: string;
  /** Null when the Window ended but its Waste cannot be measured. */
  waste: Waste | null;
}

export interface RunningCycle {
  label: string;
  resetsAt: string | null;
  /** Share of the allowance used at the newest reading, 0..1. */
  usedShare: number;
  /** How far through the Cycle `now` is, 0..1; null while its start (the previous Reset) is unknown. */
  elapsedShare: number | null;
  pace: Pace;
}

export interface LimitHitsSummary {
  count: number;
  blockedMs: number;
  stillBlocked: boolean;
}

export interface ProviderOverview {
  provider: string;
  /** The last ended Cycle per Cycle line. */
  lastCycles: CycleResult[];
  /** Up to RECENT_CYCLES ended Cycles, oldest first, for the small trend chart. */
  recentCycles: CycleResult[];
  running: RunningCycle[];
  /** Limit Hits (Sessions and Cycles) within LIMIT_HIT_LOOKBACK_MS before now. */
  limitHits: LimitHitsSummary;
  /** Overage of the running and the last ended Cycle per Cycle line. */
  overage: Omit<CycleOverage, "provider">[];
}

export interface Span {
  from: string;
  to: string;
}

export interface IdleEntry extends Span {
  label: string;
  idleMs: number;
  /** Time without readings: unknown, never counted as idle (ADR 0001). */
  unknownMs: number;
  /** `idleMs` and `unknownMs` as shares of the span, 0..1. */
  share: number;
  unknownShare: number;
  running: boolean;
}

export interface ProviderHistory {
  provider: string;
  /** Ended Cycles, oldest first. */
  cycles: CycleResult[];
  /** Ended Sessions that started, oldest first. */
  sessions: CycleResult[];
  idle: IdleEntry[];
  /** Stretches without recorded Snapshots (Backfill readings don't count either way). */
  gaps: Span[];
  /** From the first reading to now. */
  range: Span;
}

export interface ProviderHealth {
  provider: string;
  /** Newest recorded Snapshot reading; null when only Backfill readings exist. */
  lastSnapshotAt: string | null;
  stale: boolean;
}

export interface DataHealth {
  providers: ProviderHealth[];
  unclassified: { provider: string; label: string; lastSeenAt: string }[];
  recorderGaps: Gap[];
  /** Failed Backfill and Report runs among the newest RECENT_RUNS, newest first. */
  failedRuns: RunOutcome[];
  /** Stretches without Snapshots per Provider, newest first. */
  snapshotGaps: (Span & { provider: string })[];
  /** Claude calibration per account and line: samples, tokens per 1%, ready or calibrating. */
  calibration: Calibration[];
  /** Past Claude Cycles' Estimated Waste, newest first; empty while calibrating. Never Measured. */
  estimatedWaste: EstimatedWaste[];
}

export interface ProjectsPage {
  providers: { provider: string; cycles: CycleTokens[] }[];
}

export const RECENT_CYCLES = 8;
/** Cycles per Provider on the Projects and models page. */
export const RECENT_TOKEN_CYCLES = 6;
export const LIMIT_HIT_LOOKBACK_MS = 28 * 24 * 3_600_000;
/**
 * No Snapshot for longer than this is a gap: the same tolerance Idle Capacity uses, so hatched
 * gaps and unknown time agree (the Recorder runs every 5 minutes).
 */
export const SNAPSHOT_GAP_MS = READING_GAP_TOLERANCE_MS;
/** How many recorder gaps the data-health page lists. */
export const RECENT_GAPS = 200;
/** How many of the newest Backfill and Report run outcomes the data-health page looks at. */
export const RECENT_RUNS = 200;
/** A Provider whose newest Snapshot is older than this is stale. */
export const STALE_AFTER_MS = 30 * 60_000;

const RECORDER_SOURCE = "openusage";

export function buildOverview(data: DashboardData, now: string | Date): ProviderOverview[] {
  const nowMs = toMs(now);
  const windows = analysedWindows(data.readings, now);
  const { limitHits, overage, pace } = limitsOverageAndPace(data.readings, now);

  return providersWithWindows(windows).map((provider) => {
    const cycles = windows.filter((w) => w.provider === provider && w.role === "cycle");
    const ended = endedResults(cycles);
    const lastCycles = [...Map.groupBy(ended, (c) => c.label).values()].map((line) => line.at(-1)!);
    const running = cycles
      .filter((w) => !w.endedAt)
      .map((w) => {
        const last = w.readings.at(-1)!;
        const start = ended.findLast((c) => c.label === w.label)?.endedAt;
        const length = start && w.resetsAt ? toMs(w.resetsAt) - toMs(start) : 0;
        return {
          label: w.label,
          resetsAt: w.resetsAt,
          usedShare: last.limit > 0 ? last.used / last.limit : 0,
          elapsedShare: length > 0 ? Math.min(1, Math.max(0, (nowMs - toMs(start!)) / length)) : null,
          pace: pace.find((p) => p.provider === provider && p.label === w.label)!,
        };
      });
    const hits = limitHits.filter((h) => h.provider === provider && nowMs - toMs(h.hitAt) <= LIMIT_HIT_LOOKBACK_MS);
    const lastEnded = new Map(lastCycles.map((c) => [c.label, c.endedAt]));
    return {
      provider,
      lastCycles,
      recentCycles: ended.toSorted(byEnd).slice(-RECENT_CYCLES),
      running,
      limitHits: {
        count: hits.length,
        blockedMs: hits.reduce((sum, h) => sum + h.blockedMs, 0),
        stillBlocked: hits.some((h) => h.endedBy === "running"),
      },
      overage: overage
        .filter((o) => o.provider === provider && (o.cycleEndedAt === null || o.cycleEndedAt === lastEnded.get(o.cycleLabel)))
        .map(({ provider: _, ...rest }) => rest),
    };
  });
}

export function buildHistory(data: DashboardData, provider: string, now: string | Date): ProviderHistory | null {
  const readings = data.readings.filter((r) => r.provider === provider);
  const windows = analysedWindows(readings, now);
  if (windows.length === 0) return null;

  const idle = idleCapacity(windows, now, { gaps: data.gaps }).map((i) => ({
    label: i.cycle.label,
    from: i.from,
    to: i.to,
    idleMs: i.idleMs,
    unknownMs: i.unknownMs,
    share: i.share,
    unknownShare: spanShare(i.unknownMs, i.from, i.to),
    running: i.cycle.endedAt === null,
  }));
  const first = Math.min(...readings.map((r) => toMs(r.fetchedAt)));
  return {
    provider,
    cycles: endedResults(windows.filter((w) => w.role === "cycle")).toSorted(byEnd),
    sessions: endedResults(windows.filter((w) => w.role === "session" && w.waste !== null)).toSorted(byEnd),
    idle,
    gaps: snapshotGaps(readings, now),
    range: { from: iso(first), to: iso(toMs(now)) },
  };
}

export function buildHealth(data: DashboardData, now: string | Date): DataHealth {
  const nowMs = toMs(now);
  const byProvider = Map.groupBy(data.readings, (r) => r.provider);
  const providers = [...byProvider.keys()].toSorted();
  const claude = claudeCalibration(data.readings, data.tokens ?? [], now);
  return {
    calibration: claude.calibrations,
    estimatedWaste: claude.estimates.toReversed(),
    providers: providers.map((provider) => {
      const snapshots = byProvider.get(provider)!.filter((r) => r.source === RECORDER_SOURCE);
      const newest = snapshots.length ? Math.max(...snapshots.map((r) => toMs(r.fetchedAt))) : null;
      return {
        provider,
        lastSnapshotAt: newest === null ? null : iso(newest),
        stale: newest === null || nowMs - newest > STALE_AFTER_MS,
      };
    }),
    unclassified: data.latest
      .filter((r) => r.role === "unclassified")
      .map((r) => ({ provider: r.provider, label: r.label, lastSeenAt: r.fetchedAt })),
    recorderGaps: data.gaps.toReversed().slice(0, RECENT_GAPS),
    failedRuns: (data.runs ?? []).filter((r) => !r.ok),
    snapshotGaps: providers
      .flatMap((provider) => snapshotGaps(byProvider.get(provider)!, now).map((g) => ({ provider, ...g })))
      .toSorted((a, b) => toMs(b.from) - toMs(a.from)),
  };
}

/**
 * Projects and models page: token share per Project and model for the last RECENT_TOKEN_CYCLES
 * Cycles with tokens, per Provider, newest Cycle first. Projects carry folder names only.
 */
export function buildProjects(data: DashboardData, now: string | Date): ProjectsPage {
  const cycles = tokensByCycle(data.tokens ?? [], analysedWindows(data.readings, now), now);
  return {
    providers: [...Map.groupBy(cycles, (c) => c.provider)].map(([provider, own]) => ({
      provider,
      cycles: own.slice(-RECENT_TOKEN_CYCLES).toReversed(),
    })),
  };
}

/** Windows of the lines the Window Model analyses: Sessions and Cycles. */
function analysedWindows(readings: readonly Reading[], now: string | Date): Window[] {
  return deriveWindows(
    readings.filter((r) => r.role === "session" || r.role === "cycle"),
    now,
  );
}

function providersWithWindows(windows: readonly Window[]): string[] {
  return [...new Set(windows.filter((w) => w.role === "cycle").map((w) => w.provider))].toSorted();
}

function endedResults(windows: readonly Window[]): CycleResult[] {
  return windows.filter((w) => w.endedAt).map((w) => ({ label: w.label, endedAt: w.endedAt!, waste: w.waste }));
}

/** Stretches longer than SNAPSHOT_GAP_MS between one Provider's recorded Snapshots, and up to now. */
function snapshotGaps(readings: readonly Reading[], now: string | Date): Span[] {
  const times = [...new Set(readings.filter((r) => r.source === RECORDER_SOURCE).map((r) => toMs(r.fetchedAt)))].toSorted(
    (a, b) => a - b,
  );
  if (times.length === 0) return [];
  times.push(Math.max(toMs(now), times.at(-1)!));
  const gaps: Span[] = [];
  for (let i = 1; i < times.length; i++) {
    if (times[i]! - times[i - 1]! > SNAPSHOT_GAP_MS) gaps.push({ from: iso(times[i - 1]!), to: iso(times[i]!) });
  }
  return gaps;
}

function spanShare(durationMs: number, from: string, to: string): number {
  const length = toMs(to) - toMs(from);
  return length > 0 ? durationMs / length : 0;
}

function byEnd(a: CycleResult, b: CycleResult): number {
  return toMs(a.endedAt) - toMs(b.endedAt);
}

function toMs(t: string | Date): number {
  return typeof t === "string" ? Date.parse(t) : t.getTime();
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
