"use client";

import { PlanTile } from "@/components/overview/plan-tile";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlanTile as Tile } from "@/lib/plan-tiles";
import type { Overview } from "@/lib/types";

const GRID = "grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]";

/** The row of plan tiles; one is selected for the hero chart. */
export function PlanTiles({
  overview,
  tiles,
  selected,
  onSelect,
}: {
  overview: Overview;
  tiles: Tile[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className={GRID} aria-label="Plans">
      {tiles.map((tile) => (
        <PlanTile
          key={tile.key}
          tile={tile}
          now={overview.now}
          lastCycle={overview.providers.find((p) => p.provider === tile.provider)?.lastCycles.at(-1)}
          selected={tile.key === selected}
          onSelect={() => onSelect(tile.key)}
        />
      ))}
    </div>
  );
}

export function PlanTilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={GRID} aria-busy="true" aria-label="Loading plans">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-4 w-32" />
        </div>
      ))}
    </div>
  );
}
