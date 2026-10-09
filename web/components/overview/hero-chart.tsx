"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";
import { Section } from "@/components/section";
import { ApiErrorState } from "@/components/states";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { marker, percent, weekdayOrDate, clock } from "@/lib/format";
import { cycleSpan, duration, heroDomain, heroRows, heroTable, longTime, rowAt,tickLabel, timeTicks, type HeroRow } from "@/lib/hero";
import type { PlanTile } from "@/lib/plan-tiles";
import { providerColor } from "@/lib/providers";
import type { HeroCycle, Overview } from "@/lib/types";

/** What the Overview passes the hero chart: the selected plan tile, and the overview it came from. */
export interface HeroChartProps {
  /** The selected plan; null when there are no plans. */
  plan: PlanTile | null;
  overview: Overview;
}

/**
 * The selected plan's current Cycle (`GET /api/hero/:provider`): % used over time as an area in the
 * Provider's color, Pace as a dashed line from the newest reading to the Reset, the 100% limit,
 * a "now" marker, and gaps as breaks with a quiet band (never zero). A table view shows the same.
 */
export function HeroChart({ plan, overview }: HeroChartProps) {
  if (!plan) return null;
  // Keyed by plan, so switching plans starts from a loading state instead of the old plan's data.
  return <HeroForPlan key={plan.key} plan={plan} now={overview.now} />;
}

type View = "chart" | "table";

function HeroForPlan({ plan, now }: { plan: PlanTile; now: string }) {
  const label = plan.running?.label;
  const load = useCallback((init?: RequestInit) => api.hero(plan.provider, label, init), [plan.provider, label]);
  const hero = useApi(load);
  const [view, setView] = useState<View>("chart");

  const title = hero.data ? `${plan.name}: ${hero.data.label} Cycle` : plan.name;
  return (
    <Section
      id="hero"
      title={title}
      description={hero.data ? heroDescription(hero.data, now) : "Current Cycle"}
      actions={
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={view}
          onValueChange={(v) => (v === "chart" || v === "table") && setView(v)}
          aria-label="Show as"
        >
          <ToggleGroupItem value="chart" className="px-3 text-xs data-[state=on]:text-foreground">
            Chart
          </ToggleGroupItem>
          <ToggleGroupItem value="table" className="px-3 text-xs data-[state=on]:text-foreground">
            Table
          </ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {hero.status === "loading" ? (
        <HeroSkeleton />
      ) : hero.status === "error" ? (
        <ApiErrorState error={hero.error} onRetry={hero.reload} />
      ) : (
        <>
          <HeroStats hero={hero.data} now={now} />
          {view === "chart" ? (
            <HeroPlot hero={hero.data} now={now} color={providerColor(plan.provider)} name={plan.name} />
          ) : (
            <HeroTable hero={hero.data} />
          )}
        </>
      )}
    </Section>
  );
}

function heroDescription(hero: HeroCycle, now: string): string {
  const span = cycleSpan(hero);
  if (!hero.running) return `${span}. Ended, no new Cycle recorded yet`;
  return hero.resetsAt ? `${span}. Resets ${weekdayOrDate(hero.resetsAt, now)} at ${clock(hero.resetsAt)}` : span;
}

/** The headline numbers above the plot: used now, Pace at the Reset, time left. */
function HeroStats({ hero, now }: { hero: HeroCycle; now: string }) {
  const last = hero.readings.at(-1);
  const pace = hero.pace;
  const left = hero.running && hero.resetsAt ? Date.parse(hero.resetsAt) - Date.parse(now) : null;
  return (
    <dl className="mb-5 grid grid-cols-2 gap-x-8 gap-y-4 sm:flex sm:flex-wrap">
      <Stat label={hero.running ? "Used so far" : "Used at the end"}>
        {last ? (
          <>
            {marker(last.basis)}
            {Math.round(last.usedShare * 100)}
            <Unit>%</Unit>
          </>
        ) : (
          "--"
        )}
      </Stat>
      {hero.running ? (
        <Stat label={pace?.projectedLimitHitAt ? "Pace: maxes out" : "Pace at the Reset"}>
          {pace ? (
            pace.projectedLimitHitAt ? (
              <>{weekdayOrDate(pace.projectedLimitHitAt, now)}<Unit>{clock(pace.projectedLimitHitAt)}</Unit></>
            ) : (
              <>
                ~{Math.round(pace.projectedShare * 100)}
                <Unit>%</Unit>
              </>
            )
          ) : (
            <span className="text-muted-foreground">--</span>
          )}
        </Stat>
      ) : null}
      {hero.running && pace && !pace.projectedLimitHitAt ? (
        <Stat label="Waste ahead">
          ~{Math.round(pace.expectedWaste * 100)}
          <Unit>%</Unit>
        </Stat>
      ) : null}
      {left !== null ? <Stat label="Until the Reset">{duration(left)}</Stat> : null}
    </dl>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-3xl leading-none font-medium tracking-tighter tabular-nums">{children}</dd>
    </div>
  );
}

function Unit({ children }: { children: React.ReactNode }) {
  return <span className="ml-0.5 text-lg text-muted-foreground">{children}</span>;
}

function HeroPlot({ hero, now, color, name }: { hero: HeroCycle; now: string; color: string; name: string }) {
  const gradientId = `hero-fill-${useId().replace(/:/g, "")}`;
  const rows = useMemo(() => heroRows(hero), [hero]);
  const domain = useMemo(() => heroDomain(hero, now), [hero, now]);
  const ticks = useMemo(() => timeTicks(domain), [domain]);
  const nowMs = Date.parse(now);
  const top = Math.max(100, ...rows.map((r) => Math.max(r.used ?? 0, r.pace ?? 0)));
  const yTicks = top > 100 ? [0, 25, 50, 75, 100, Math.ceil(top / 25) * 25] : [0, 25, 50, 75, 100];
  const config = {
    used: { label: "Used", color },
    pace: { label: "Pace", color },
  } satisfies ChartConfig;

  if (rows.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">No readings in this Cycle yet.</p>;
  }

  return (
    <figure className="flex flex-col gap-3">
      <ChartContainer
        config={config}
        className="aspect-auto h-72 w-full sm:h-80"
        role="img"
        aria-label={`${name}: % of the allowance used through the Cycle, with Pace to the Reset. The table view lists the values.`}
      >
        <ComposedChart data={rows} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-used)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-used)" stopOpacity={0.02} />
            </linearGradient>
            {/* Gaps: a quiet hatch (unknown, never zero), so they read as "no data", not as a value. */}
            <pattern id={`${gradientId}-gap`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--muted-foreground)" fillOpacity={0.03} />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--muted-foreground)" strokeOpacity={0.16} strokeWidth={1} />
            </pattern>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="0" className="[&_line]:stroke-border/60" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={domain}
            ticks={ticks}
            tickFormatter={(t: number) => tickLabel(t, domain)}
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            minTickGap={24}
            allowDataOverflow
          />
          <YAxis
            domain={[0, yTicks.at(-1)!]}
            ticks={yTicks}
            tickFormatter={(v: number) => `${v}%`}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          {hero.gaps.map((g) => (
            <ReferenceArea
              key={g.from}
              x1={Date.parse(g.from)}
              x2={Date.parse(g.to)}
              ifOverflow="hidden"
              fill={`url(#${gradientId}-gap)`}
              fillOpacity={1}
              stroke="none"
            />
          ))}
          <ReferenceLine
            y={100}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.7}
            strokeWidth={1}
          />
          {hero.running && nowMs > domain[0] && nowMs < domain[1] ? (
            <ReferenceLine
              x={nowMs}
              stroke="var(--foreground)"
              strokeOpacity={0.35}
              strokeWidth={1}
              label={{ value: "Now", position: "top", fill: "var(--muted-foreground)", fontSize: 11 }}
            />
          ) : null}
          <ChartTooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }}
            content={({ active, label }) => (
              <HeroTooltip active={active} row={typeof label === "number" ? rowAt(rows, label) : undefined} />
            )}
            isAnimationActive={false}
          />
          <Area
            dataKey="used"
            type="linear"
            stroke="var(--color-used)"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            connectNulls={false}
            dot={LoneDot}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: "var(--color-used)" }}
            isAnimationActive={false}
          />
          <Line
            dataKey="pace"
            type="linear"
            stroke="var(--color-pace)"
            strokeWidth={2}
            strokeDasharray="5 5"
            strokeOpacity={0.85}
            connectNulls
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: "var(--color-pace)" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ChartContainer>
      <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
        <LegendItem swatch={<span className="h-2.5 w-3.5 rounded-[3px] border-t-2" style={{ borderColor: color, background: `color-mix(in oklab, ${color} 22%, transparent)` }} />}>
          Used
        </LegendItem>
        {hero.pace ? (
          <LegendItem swatch={<span className="w-3.5 border-t-2 border-dashed" style={{ borderColor: color }} />}>
            Pace to the Reset
          </LegendItem>
        ) : hero.running ? (
          <span>Pace shows once there is a rate</span>
        ) : null}
        <LegendItem swatch={<span className="w-3.5 border-t border-muted-foreground" />}>Limit (100%)</LegendItem>
        {hero.gaps.length ? (
          <LegendItem swatch={<span className="h-2.5 w-3.5 rounded-[3px] border border-muted-foreground/25 bg-[repeating-linear-gradient(135deg,var(--muted-foreground)_0_1px,transparent_1px_4px)] opacity-60" />}>No readings</LegendItem>
        ) : null}
      </figcaption>
    </figure>
  );
}

function LegendItem({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center" aria-hidden>
        {swatch}
      </span>
      {children}
    </span>
  );
}

/** A dot for a reading with gaps on both sides, which no line reaches; nothing for the others. */
function LoneDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: HeroRow }) {
  if (!payload?.alone || cx === undefined || cy === undefined) return <g />;
  return <circle cx={cx} cy={cy} r={3} fill="var(--color-used)" stroke="var(--card)" strokeWidth={1.5} />;
}

function HeroTooltip({ active, row }: { active?: boolean; row: HeroRow | undefined }) {
  if (!active || !row) return null;
  return (
    <div className="grid min-w-36 gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium">{longTime(row.t)}</p>
      {row.used !== null ? (
        <TooltipLine label="Used" value={`${marker(row.basis ?? "measured")}${percent(row.used / 100)}`} />
      ) : row.pace === undefined ? (
        <p className="text-muted-foreground">No readings</p>
      ) : null}
      {row.pace !== undefined && row.used === null ? <TooltipLine label="Pace" value={`~${percent(row.pace / 100)}`} dashed /> : null}
    </div>
  );
}

function TooltipLine({ label, value, dashed }: { label: string; value: string; dashed?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span
          className={dashed ? "w-2.5 border-t-2 border-dashed border-(--color-pace)" : "size-2 rounded-[2px] bg-(--color-used)"}
          aria-hidden
        />
        {label}
      </span>
      <span className="font-mono font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}

function HeroTable({ hero }: { hero: HeroCycle }) {
  const rows = heroTable(hero);
  return (
    <div className="max-h-80 overflow-auto rounded-lg border">
      <Table>
        <caption className="sr-only">
          {hero.label} Cycle: % used at each change, gaps without readings, and Pace. Newest first.
        </caption>
        <TableHeader className="sticky top-0 bg-card">
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>What</TableHead>
            <TableHead className="text-right">Used</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.at}-${r.kind}`}>
              <TableCell className="font-mono text-xs tabular-nums">{longTime(r.at)}</TableCell>
              <TableCell className="text-muted-foreground">{r.kind}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{r.used}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the Cycle" className="flex flex-col gap-5">
      <div className="flex gap-8">
        <Skeleton className="h-12 w-24" />
        <Skeleton className="h-12 w-24" />
        <Skeleton className="h-12 w-24" />
      </div>
      <Skeleton className="h-72 w-full opacity-50 sm:h-80" />
    </div>
  );
}
