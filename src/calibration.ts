import { CALIBRATED_PROVIDER_IDS, LIVE_SOURCE } from "./providers.ts";
import type { TokenEvent } from "./store.ts";
import { formatTokens } from "./summary.ts";
import { type CycleTokens, tokensByCycle, tokenTotal } from "./token-shares.ts";
import { deriveWindows, type Reading, type Window } from "./window-model.ts";

/**
 * Calibration (spec §4, ticket #8): how many tokens one percentage point of a Claude Session or
 * Cycle is worth, learned from live Snapshots, per Provider (account). Pure functions, no I/O,
 * recomputed from the store on every call, so it follows new Snapshots on its own.
 *
 * An interval is two consecutive live Snapshots of the same Window. Its tokens are the Provider's
 * token events between them. Tokens per 1% is the sum of tokens over the sum of used% movement
 * across every interval, so rounding of used% (an interval of 0.4% shows 0) evens out.
 */

/** Providers whose past Waste is estimated from tokens. Codex logs record the limit (Measured). */
export const CALIBRATED_PROVIDERS: readonly string[] = CALIBRATED_PROVIDER_IDS;

/** Intervals that moved used% and had tokens, needed before a calibration is used. */
export const MIN_CALIBRATION_SAMPLES = 10;
/** Total used% movement (percentage points) needed before a calibration is used. */
export const MIN_CALIBRATION_MOVEMENT = 20;

const DEFAULT_LABELS: Record<"session" | "cycle", string> = { session: "Session", cycle: "Weekly" };

export interface Calibration {
  provider: string;
  /** The line it was learned from (e.g. "Session", "Weekly"). */
  label: string;
  role: "session" | "cycle";
  /** Intervals where used% moved and tokens were logged. */
  samples: number;
  /** Used% movement over all counted intervals, in percentage points. */
  movement: number;
  /** Tokens over all counted intervals. */
  tokens: number;
  /** True once `samples` and `movement` reach the minimums. */
  ready: boolean;
  /** Tokens per percentage point; null while calibrating. */
  tokensPerPercent: number | null;
}

/**
 * One Calibration per Claude Provider and Session or Cycle line, sorted by Provider, then
 * Session before Cycle. `readings` may hold any source; only live Snapshots count. Intervals
 * starting after the Provider's newest token event are skipped (its tokens are not read in yet).
 */
export function calibrate(readings: readonly Reading[], events: readonly TokenEvent[], now: string | Date): Calibration[] {
  const live = readings.filter(
    (r) =>
      r.source === LIVE_SOURCE &&
      (r.role === "session" || r.role === "cycle") &&
      CALIBRATED_PROVIDERS.includes(r.provider),
  );
  const windows = deriveWindows(live, now);
  const providers = [
    ...new Set([...live.map((r) => r.provider), ...events.map((e) => e.provider)]),
  ]
    .filter((p) => CALIBRATED_PROVIDERS.includes(p))
    .toSorted();

  return providers.flatMap((provider) => {
    const own = events.filter((e) => e.provider === provider).map((e) => ({ at: ms(e.at), tokens: tokenTotal(e) }));
    const coveredUntil = own.length ? Math.max(...own.map((e) => e.at)) : -Infinity;
    return (["session", "cycle"] as const).flatMap((role) => {
      const lines = windows.filter((w) => w.provider === provider && w.role === role);
      const labels = [...new Set(lines.map((w) => w.label))].toSorted();
      if (labels.length === 0) labels.push(DEFAULT_LABELS[role]);
      return labels.map((label) => {
        let samples = 0;
        let movement = 0;
        let tokens = 0;
        for (const w of lines.filter((l) => l.label === label)) {
          for (let i = 1; i < w.readings.length; i++) {
            const a = w.readings[i - 1]!;
            const b = w.readings[i]!;
            const from = ms(a.fetchedAt);
            const to = ms(b.fetchedAt);
            if (from > coveredUntil) continue;
            const moved = percent(b) - percent(a);
            if (moved < 0) continue;
            const inside = own.reduce((sum, e) => (e.at >= from && e.at < to ? sum + e.tokens : sum), 0);
            movement += moved;
            tokens += inside;
            if (moved > 0 && inside > 0) samples++;
          }
        }
        const ready = samples >= MIN_CALIBRATION_SAMPLES && movement >= MIN_CALIBRATION_MOVEMENT;
        return {
          provider,
          label,
          role,
          samples,
          movement: round(movement),
          tokens,
          ready,
          tokensPerPercent: ready ? tokens / movement : null,
        };
      });
    });
  });
}

/** A past Cycle's Waste converted from its tokens. Always shown marked "~", never with Measured. */
export interface EstimatedWaste {
  provider: string;
  label: string;
  /** Inclusive start (the previous Reset). */
  from: string;
  /** Exclusive end (the Reset). */
  to: string;
  /** True when the Cycle's span was stepped or assumed rather than recorded (see CycleSpan). */
  inferred: boolean;
  tokens: number;
  /** Tokens as a share of the allowance; above 1 when the calibration says the tokens exceed it. */
  usedShare: number;
  /** Unused share of the allowance at the Reset, 0..1. */
  share: number;
  basis: "estimated";
}

/** A Measured Waste whose Reset lies this close to a token Cycle's end is that Cycle's. */
const SAME_RESET_MS = 60 * 60_000;

/**
 * Estimated Waste for every ended Claude Cycle with tokens (from tokensByCycle), oldest first,
 * once its account's Cycle calibration is ready; none while calibrating. A Cycle that already has
 * a Measured Waste in `windows` (the Window Model's) gets no estimate, so the two never mix.
 */
export function estimateCycleWaste(
  cycles: readonly CycleTokens[],
  calibrations: readonly Calibration[],
  windows: readonly Window[],
): EstimatedWaste[] {
  return cycles.flatMap((c) => {
    if (c.running) return [];
    const own = calibrations.filter((k) => k.provider === c.provider && k.role === "cycle" && k.ready);
    const calibration = own.find((k) => k.label === c.label) ?? own[0];
    if (!calibration?.tokensPerPercent) return [];
    const measured = windows.some(
      (w) =>
        w.provider === c.provider &&
        w.role === "cycle" &&
        w.waste?.basis === "measured" &&
        w.endedAt !== null &&
        Math.abs(ms(w.endedAt) - ms(c.to)) <= SAME_RESET_MS,
    );
    if (measured) return [];
    const usedShare = c.total / (calibration.tokensPerPercent * 100);
    return [
      {
        provider: c.provider,
        label: c.label,
        from: c.from,
        to: c.to,
        inferred: c.inferred,
        tokens: c.total,
        usedShare: round(usedShare),
        share: round(Math.max(0, 1 - usedShare)),
        basis: "estimated" as const,
      },
    ];
  });
}

export interface ClaudeCalibration {
  calibrations: Calibration[];
  /** Ended Claude Cycles converted to Estimated Waste (accounts with a ready calibration only). */
  estimates: EstimatedWaste[];
  /** Claude Cycles with tokens, oldest first (tokens only while calibrating). */
  cycles: CycleTokens[];
}

/**
 * Everything the summary and the dashboard show about Claude calibration, from stored readings
 * (any role and source) and token events, recomputed on every call.
 */
export function claudeCalibration(readings: readonly Reading[], events: readonly TokenEvent[], now: string | Date): ClaudeCalibration {
  const windows = deriveWindows(
    readings.filter((r) => r.role === "session" || r.role === "cycle"),
    now,
  );
  const claudeEvents = events.filter((e) => CALIBRATED_PROVIDERS.includes(e.provider));
  const calibrations = calibrate(readings, claudeEvents, now);
  const cycles = tokensByCycle(claudeEvents, windows, now);
  return { calibrations, estimates: estimateCycleWaste(cycles, calibrations, windows), cycles };
}

/** Past Cycles per Provider the summary section lists, newest last. */
export const SUMMARY_PAST_CYCLES = 4;

/**
 * Plain-text calibration section (`bun run summary`): per Claude account and line, whether the
 * calibration is ready (tokens per 1%) or calibrating, then its past Cycles: "~" Estimated Waste
 * once ready, tokens only until then. `cycles` are tokensByCycle's. Empty without Claude data.
 */
export function formatCalibration(
  calibrations: readonly Calibration[],
  estimates: readonly EstimatedWaste[],
  cycles: readonly CycleTokens[],
  options: { timeZone?: string } = {},
): string {
  if (calibrations.length === 0) return "";
  const time = new Intl.DateTimeFormat("sv-SE", {
    timeZone: options.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const span = (from: string, to: string) => `${time.format(new Date(from))} to ${time.format(new Date(to))}`;
  const points = (n: number) => `${Number(n.toFixed(1))} points`;

  const out = ["Claude calibration (tokens per 1%, from live Snapshots)"];
  for (const [provider, own] of Map.groupBy(calibrations, (c) => c.provider)) {
    out.push(provider);
    const width = Math.max(...own.map((c) => c.label.length));
    for (const c of own) {
      const label = c.label.padEnd(width);
      if (c.ready) {
        out.push(`  ${label}  ${"ready".padEnd(11)}  ${formatTokens(c.tokensPerPercent!)} tokens per 1%  ${c.samples} samples, ${points(c.movement)}`);
      } else {
        out.push(
          `  ${label}  calibrating  ${c.samples} samples, ${points(c.movement)} (needs ${MIN_CALIBRATION_SAMPLES} samples, ${MIN_CALIBRATION_MOVEMENT} points)`,
        );
      }
      if (c.role !== "cycle") continue;
      if (c.ready) {
        for (const e of estimates.filter((e) => e.provider === provider && e.label === c.label).slice(-SUMMARY_PAST_CYCLES)) {
          const note = e.inferred ? "  (Cycle inferred)" : "";
          out.push(`    Estimated Waste  ${span(e.from, e.to)}  ${formatTokens(e.tokens)} tokens  Waste ~${Math.round(e.share * 100)}%${note}`);
        }
      } else {
        for (const t of cycles.filter((t) => t.provider === provider && t.label === c.label && !t.running).slice(-SUMMARY_PAST_CYCLES)) {
          out.push(`    tokens only  ${span(t.from, t.to)}  ${formatTokens(t.total)} tokens`);
        }
      }
    }
  }
  return out.join("\n");
}

function percent(r: Reading): number {
  return r.limit > 0 ? (r.used / r.limit) * 100 : 0;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function ms(iso: string): number {
  return Date.parse(iso);
}
