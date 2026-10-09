"use client";

import { useState } from "react";
import { HeroChart } from "@/components/overview/hero-chart";
import { PlanTiles, PlanTilesSkeleton } from "@/components/overview/plan-tiles";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorState, EmptyState } from "@/components/states";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { clock, dayMonth } from "@/lib/format";
import { planTiles } from "@/lib/plan-tiles";

/**
 * Overview: plan tiles, then the hero chart of the selected plan. Sections below the hero each
 * get one line here and their own component file.
 */
export function OverviewPage() {
  const overview = useApi(api.overview);
  const [picked, setPicked] = useState<string | null>(null);

  if (overview.status === "loading") {
    return (
      <Page>
        <PlanTilesSkeleton />
        <div className="flex h-80 flex-col gap-4 rounded-xl border bg-card p-5" aria-hidden>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="w-full flex-1 opacity-50" />
        </div>
      </Page>
    );
  }
  if (overview.status === "error") {
    return (
      <Page>
        <ApiErrorState error={overview.error} onRetry={overview.reload} />
      </Page>
    );
  }

  const data = overview.data;
  const tiles = planTiles(data);
  if (tiles.length === 0) {
    return (
      <Page>
        <EmptyState title="No Cycles recorded yet">
          Start OpenUsage and the Recorder (<code className="font-mono text-foreground">bun run record</code>, or the
          launchd job in the README). Plans show up here after the first Snapshot.
        </EmptyState>
      </Page>
    );
  }
  const plan = tiles.find((t) => t.key === picked) ?? tiles[0]!;

  return (
    <Page updatedAt={data.now}>
      <PlanTiles overview={data} tiles={tiles} selected={plan.key} onSelect={setPicked} />
      <HeroChart plan={plan} overview={data} />
    </Page>
  );
}

function Page({ children, updatedAt }: { children: React.ReactNode; updatedAt?: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        {updatedAt ? (
          <p className="text-xs text-muted-foreground">
            As of {dayMonth(updatedAt)} {clock(updatedAt)}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
