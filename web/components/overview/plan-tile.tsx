"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { marker, paceText, percent, resetText } from "@/lib/format";
import type { PlanTile as Tile } from "@/lib/plan-tiles";
import { providerColor } from "@/lib/providers";
import { statusLook } from "@/lib/status";
import type { CycleResult } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * One plan: the running Cycle's % used (the headline), a meter with a tick at how far through the
 * Cycle it is, the change vs the last Cycle at the same point, and the status dot with its Pace.
 * Pressing it selects the plan for the hero chart.
 */
export function PlanTile({
  tile,
  now,
  lastCycle,
  selected,
  onSelect,
}: {
  tile: Tile;
  now: string;
  lastCycle: CycleResult | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const { running } = tile;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-colors",
        "hover:border-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        selected && "border-primary/60 ring-1 ring-primary/60 hover:border-primary/60",
      )}
    >
      <div className="flex items-center gap-2 text-[13px]">
        <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: providerColor(tile.provider) }} aria-hidden />
        <span className="truncate font-medium">{tile.name}</span>
      </div>

      {running ? <RunningBody tile={tile} now={now} /> : <IdleBody lastCycle={lastCycle} />}
    </button>
  );
}

function RunningBody({ tile, now }: { tile: Tile; now: string }) {
  const running = tile.running!;
  const status = statusLook(running.status);
  const used = Math.min(1, Math.max(0, running.usedShare));
  const elapsed = running.elapsedShare;
  return (
    <>
      <div className="flex items-end justify-between gap-2">
        <p className="font-mono text-4xl leading-none font-medium tracking-tighter tabular-nums">
          {marker(running.pace.basis)}
          {Math.round(used * 100)}
          <span className="text-xl text-muted-foreground">%</span>
          <span className="sr-only"> of the {running.label} allowance used</span>
        </p>
        <DeltaChip tile={tile} />
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative h-1.5 w-full rounded-full bg-track" aria-hidden>
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${used * 100}%`, background: providerColor(tile.provider) }}
            />
            {elapsed !== null ? (
              <div
                className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70 ring-2 ring-card"
                style={{ left: `${elapsed * 100}%` }}
              />
            ) : null}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          {percent(used)} used
          {elapsed !== null ? `, ${percent(elapsed)} of the Cycle gone (tick)` : ", Cycle start unknown"}
        </TooltipContent>
      </Tooltip>

      <div className="flex flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap"
            title={status.description}
          >
            <span className="size-1.5 rounded-full" style={{ background: status.color }} aria-hidden />
            {status.label}
          </span>
          <span className="truncate text-muted-foreground">{paceText(running.pace, now)}</span>
        </div>
        <p className="text-xs text-muted-foreground">{resetText(running.resetsAt, now)}</p>
      </div>
    </>
  );
}

function DeltaChip({ tile }: { tile: Tile }) {
  const { delta, running } = tile;
  if (!delta || !running?.lastCycleAtSamePoint) return null;
  const Icon = delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : ArrowRight;
  const before = running.lastCycleAtSamePoint;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-0.5 rounded-md border bg-muted/60 px-1.5 py-0.5 font-mono text-xs tabular-nums">
          <Icon className="size-3 text-muted-foreground" aria-hidden />
          {delta.text}
          <span className="sr-only"> vs the same point in the last Cycle</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        vs the same point in the last Cycle ({marker(before.basis)}
        {percent(before.usedShare)} used)
      </TooltipContent>
    </Tooltip>
  );
}

function IdleBody({ lastCycle }: { lastCycle: CycleResult | undefined }) {
  const waste = lastCycle?.waste;
  return (
    <>
      <p className="font-mono text-4xl leading-none font-medium text-muted-foreground">
        <span aria-hidden>--</span>
        <span className="sr-only">No running Cycle</span>
      </p>
      <div className="h-1.5 w-full rounded-full bg-track" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-medium text-muted-foreground">No running Cycle</p>
        <p className="text-xs text-muted-foreground">
          {waste ? `Last Cycle: ${marker(waste.basis)}${percent(waste.share)} wasted` : "Waiting for a Snapshot"}
        </p>
      </div>
    </>
  );
}
