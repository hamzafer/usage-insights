import { deltaPoints, type Delta } from "./format";
import { byProviderOrder, providerName } from "./providers";
import type { Overview, RunningCycle } from "./types";

/**
 * The plan tiles row: one tile per Provider and running Cycle line (Provider name alone when it
 * has one Cycle line), in the fixed Provider order. A Provider whose Cycle has ended without a
 * new one recorded yet gets a tile without a running Cycle.
 */
export interface PlanTile {
  /** Stable key, also the hero chart's selection: `<provider>` or `<provider>/<label>`. */
  key: string;
  provider: string;
  name: string;
  running: RunningCycle | null;
  delta: Delta | null;
}

export function planTiles(overview: Overview): PlanTile[] {
  return overview.providers
    .toSorted((a, b) => byProviderOrder(a.provider, b.provider))
    .flatMap((p): PlanTile[] => {
      if (p.running.length === 0) {
        return [{ key: p.provider, provider: p.provider, name: providerName(p.provider), running: null, delta: null }];
      }
      const many = p.running.length > 1;
      return p.running.map((running) => ({
        key: many ? `${p.provider}/${running.label}` : p.provider,
        provider: p.provider,
        name: many ? `${providerName(p.provider)} ${running.label}` : providerName(p.provider),
        running,
        delta: running.lastCycleAtSamePoint
          ? deltaPoints(running.usedShare, running.lastCycleAtSamePoint.usedShare, running.lastCycleAtSamePoint.basis)
          : null,
      }));
    });
}
