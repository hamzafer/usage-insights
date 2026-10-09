"use client";

import { ChartColumn, Table2, X } from "lucide-react";
import { useCallback, useState } from "react";
import type { AnalyticsSectionProps } from "@/components/analytics/types";
import { ProviderTabs } from "@/components/provider-tabs";
import { Section } from "@/components/section";
import { ApiErrorState, EmptyState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { clock, dayMonth, marker, percent } from "@/lib/format";
import { type Averages, averages, blockedText, blockedTotal, CYCLES_PER_RANGE, cyclesForRange, rangeCaption } from "@/lib/history";
import { byProviderOrder, providerColor, providerName } from "@/lib/providers";
import type { HistoryCycle } from "@/lib/types";
import { cn } from "@/lib/utils";

type View = "chart" | "table";

/**
 * Waste and Limit history (#20): per plan (tabs), one stacked bar per Cycle, used (Provider color)
 * under wasted (neutral), with Limit Hits marked above the bar. Estimated Cycles are hatched and
 * marked "~", low-confidence ones lightly faded (most real Codex Cycles are, so they stay readable;
 * the tooltip and table say why), the running Cycle drawn open (no Waste yet). The range
 * toggle picks how many Cycles show (lib/history.ts).
 */
export function WasteHistory({ range }: AnalyticsSectionProps) {
  const overview = useApi(api.overview);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<View>("chart");

  const providers = overview.status === "ready" ? overview.data.providers.map((p) => p.provider).toSorted(byProviderOrder) : [];
  const provider = picked && providers.includes(picked) ? picked : (providers[0] ?? null);

  const actions =
    providers.length > 0 ? (
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={view}
        onValueChange={(v) => (v === "chart" || v === "table") && setView(v)}
        aria-label="View"
      >
        <ToggleGroupItem value="chart" aria-label="Chart" className="px-2.5">
          <ChartColumn aria-hidden />
        </ToggleGroupItem>
        <ToggleGroupItem value="table" aria-label="Table" className="px-2.5">
          <Table2 aria-hidden />
        </ToggleGroupItem>
      </ToggleGroup>
    ) : null;

  return (
    <Section
      id="waste-history"
      title="Waste and Limit history"
      description={`Used and wasted share of each Cycle at its Reset. ${rangeCaption(range)}.`}
      actions={actions}
    >
      {overview.status === "loading" ? (
        <ChartSkeleton />
      ) : overview.status === "error" ? (
        <ApiErrorState error={overview.error} onRetry={overview.reload} />
      ) : provider === null ? (
        <EmptyState title="No Cycles recorded yet">Each plan&apos;s Cycles show up here after their first Snapshot.</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <ProviderTabs providers={providers} value={provider} onChange={setPicked} />
          <ProviderHistory key={provider} provider={provider} range={range} view={view} />
        </div>
      )}
    </Section>
  );
}

function ProviderHistory({ provider, range, view }: { provider: string } & AnalyticsSectionProps & { view: View }) {
  const load = useCallback((init?: RequestInit) => api.history(provider, init), [provider]);
  const history = useApi(load);

  if (history.status === "loading") return <ChartSkeleton />;
  if (history.status === "error") {
    if (history.error.status === 404) {
      return <EmptyState title="No Cycles yet">{providerName(provider)} has no recorded Cycles to show.</EmptyState>;
    }
    return <ApiErrorState error={history.error} onRetry={history.reload} />;
  }

  const cycles = cyclesForRange(history.data.cycles, range);
  const color = providerColor(provider);
  return (
    <div className="flex flex-col gap-5">
      <Legend averages={averages(cycles)} color={color} cycles={cycles} />
      {view === "chart" ? <Bars cycles={cycles} color={color} slots={CYCLES_PER_RANGE[range]} /> : <HistoryTable cycles={cycles} />}
    </div>
  );
}

/** ChatGPT-style legend: big average shares over the shown ended Cycles, one row per basis. */
function Legend({ averages: avg, color, cycles }: { averages: Averages[]; color: string; cycles: HistoryCycle[] }) {
  const hasEstimated = cycles.some((c) => c.basis === "estimated");
  const hasHits = cycles.some((c) => c.limitHits.length > 0);
  const hasRunning = cycles.some((c) => c.running);
  const hasLow = cycles.some((c) => c.lowConfidence);
  return (
    <div className="flex flex-col gap-3">
      {avg.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No ended Cycle in view yet: averages show after the first Reset.</p>
      ) : (
        avg.map((a) => (
          <div key={a.basis} className="flex flex-wrap items-end gap-x-8 gap-y-2">
            <BigShare swatch={<Swatch color={color} estimated={a.basis === "estimated"} />} label="Used" value={a.used} basis={a.basis} />
            <BigShare swatch={<Swatch neutral estimated={a.basis === "estimated"} />} label="Wasted" value={a.wasted} basis={a.basis} />
            <p className="pb-1 text-xs text-muted-foreground">
              Average of {a.count} {a.basis === "estimated" ? "Estimated" : "Measured"} {a.count === 1 ? "Cycle" : "Cycles"}
            </p>
          </div>
        ))
      )}
      {hasEstimated || hasHits || hasRunning || hasLow ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {hasEstimated ? (
            <li className="flex items-center gap-1.5">
              <Swatch color={color} estimated /> ~ Estimated from tokens
            </li>
          ) : null}
          {hasRunning ? (
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px] border border-dashed border-foreground/40" aria-hidden /> Running Cycle
            </li>
          ) : null}
          {hasLow ? (
            <li className="flex items-center gap-1.5">
              <Swatch color={color} faded /> Lighter: low confidence
            </li>
          ) : null}
          {hasHits ? (
            <li className="flex items-center gap-1.5">
              <HitMark /> Limit Hit
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function BigShare({ swatch, label, value, basis }: { swatch: React.ReactNode; label: string; value: number; basis: Averages["basis"] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        {swatch}
        {label}
      </span>
      <span className="font-mono text-3xl leading-none font-medium tracking-tighter tabular-nums">
        {marker(basis)}
        {Math.round(value * 100)}
        <span className="text-lg text-muted-foreground">%</span>
      </span>
    </div>
  );
}

function Swatch({ color, neutral, estimated, faded }: { color?: string; neutral?: boolean; estimated?: boolean; faded?: boolean }) {
  return (
    <span
      className={cn("inline-block size-2.5 shrink-0 rounded-[3px]", neutral && "bg-foreground/20", faded && "opacity-70")}
      style={neutral ? (estimated ? hatch("color-mix(in oklab, var(--foreground) 30%, transparent)", true) : undefined) : fill(color!, estimated)}
      aria-hidden
    />
  );
}

const PLOT_HEIGHT = 192;

/** One column per Cycle: used at the bottom, 2px gap, wasted above; 100% at the top of the plot. */
function Bars({ cycles, color, slots }: { cycles: HistoryCycle[]; color: string; slots: number }) {
  return (
    <div className="flex gap-3" role="img" aria-label="Used and wasted share per Cycle; the table view lists the values">
      <div className="relative w-8 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums" style={{ height: PLOT_HEIGHT + 20 }} aria-hidden>
        {[1, 0.5, 0].map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: 20 + (1 - t) * PLOT_HEIGHT }}>
            {t * 100}%
          </span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        {[1, 0.5, 0].map((t) => (
          <div
            key={t}
            className={cn("pointer-events-none absolute inset-x-0 border-t", t === 0 ? "border-border" : "border-dashed border-border/70")}
            style={{ top: 20 + (1 - t) * PLOT_HEIGHT }}
            aria-hidden
          />
        ))}
        <div className="relative flex items-stretch justify-around gap-2 sm:gap-3">
          {/* Fixed slots per range, newest on the right, so bar widths stay put with few Cycles. */}
          {Array.from({ length: Math.max(0, slots - cycles.length) }, (_, i) => (
            <div key={`empty-${i}`} className="max-w-16 min-w-0 flex-1" aria-hidden />
          ))}
          {cycles.map((c, i) => (
            <Column
              key={`${c.resetAt}-${i}`}
              cycle={c}
              color={color}
              // On phones, many Cycles label every third bar (counted from the newest) so dates never collide.
              sparseLabel={cycles.length > 6 && (cycles.length - 1 - i) % 3 !== 0}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Column({ cycle: c, color, sparseLabel }: { cycle: HistoryCycle; color: string; sparseLabel: boolean }) {
  const estimated = c.basis === "estimated";
  const used = Math.min(1, Math.max(0, c.usedShare));
  const rest = c.running ? 1 - used : Math.max(0, c.wasteShare ?? 0);
  const blocked = blockedTotal(c);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="group flex max-w-16 min-w-0 flex-1 flex-col items-center rounded-md outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={summary(c)}
        >
          <div className="flex h-5 items-start justify-center">
            {c.limitHits.length > 0 ? (
              <span className="flex items-center gap-0.5 font-mono text-[11px] text-foreground">
                <HitMark />
                {c.limitHits.length > 1 ? c.limitHits.length : null}
              </span>
            ) : null}
          </div>
          <div
            className={cn("flex w-full flex-col justify-end gap-[2px]", c.lowConfidence && "opacity-70")}
            style={{ height: PLOT_HEIGHT }}
          >
            {rest > 0.0005 ? (
              c.running ? (
                <div className="min-h-0 rounded-t-[4px] border border-b-0 border-dashed border-foreground/30" style={{ flex: `${rest} 1 0` }} />
              ) : (
                <div
                  className={cn("min-h-[2px] rounded-t-[4px]", !estimated && "bg-foreground/15")}
                  style={{ flex: `${rest} 1 0`, ...(estimated ? hatch("color-mix(in oklab, var(--foreground) 22%, transparent)", true) : {}) }}
                />
              )
            ) : null}
            {used > 0.0005 ? (
              <div
                className={cn("min-h-[2px]", rest > 0.0005 ? "" : "rounded-t-[4px]")}
                style={{ flex: `${used} 1 0`, ...fill(color, estimated) }}
              />
            ) : null}
          </div>
          <span className={cn("mt-2 font-mono text-[11px] whitespace-nowrap tabular-nums", sparseLabel && "max-sm:invisible", c.running ? "text-foreground" : "text-muted-foreground")}>
            {c.running ? "now" : c.resetAt ? dayMonth(c.resetAt) : "?"}
          </span>
          {blocked > 0 ? <span className="sr-only">blocked {blockedText(blocked)}</span> : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-80 text-pretty">
        <CycleTooltip cycle={c} />
      </TooltipContent>
    </Tooltip>
  );
}

function CycleTooltip({ cycle: c }: { cycle: HistoryCycle }) {
  const m = marker(c.basis);
  return (
    <div className="flex flex-col gap-1 text-left">
      <p className="font-medium">{span(c)}</p>
      <p className="font-mono tabular-nums">
        {m}
        {percent(c.usedShare)} used
        {c.wasteShare !== null ? `, ${m}${percent(c.wasteShare)} wasted` : ""}
      </p>
      <p className="opacity-75">
        {c.running ? "Running: Waste is known at the Reset" : c.basis === "estimated" ? "Estimated from tokens" : "Measured"}
        {c.lowConfidence ? ". Low confidence: last reading over 30 min before the Reset" : ""}
        {c.inferred ? ". Cycle dates inferred" : ""}
      </p>
      {c.limitHits.map((h) => (
        <p key={h.hitAt} className="flex items-center gap-1">
          <X className="size-3 shrink-0" aria-hidden />
          {h.role === "session" ? "Session" : c.label} Limit Hit {dayMonth(h.hitAt)} {clock(h.hitAt)}, blocked {blockedText(h.blockedMs)}
          {h.endedBy === "overage" ? " (then Overage)" : h.endedBy === "running" ? " so far" : ""}
        </p>
      ))}
    </div>
  );
}

function HistoryTable({ cycles }: { cycles: HistoryCycle[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-4 font-normal">Cycle</th>
            <th className="py-2 pr-4 text-right font-normal">Used</th>
            <th className="py-2 pr-4 text-right font-normal">Wasted</th>
            <th className="py-2 pr-4 font-normal">Basis</th>
            <th className="py-2 font-normal">Limit Hits</th>
          </tr>
        </thead>
        <tbody>
          {cycles.toReversed().map((c, i) => (
            <tr key={`${c.resetAt}-${i}`} className="border-b last:border-0">
              <td className="py-2 pr-4 whitespace-nowrap">{span(c)}</td>
              <td className="py-2 pr-4 text-right font-mono tabular-nums">
                {marker(c.basis)}
                {percent(c.usedShare)}
              </td>
              <td className="py-2 pr-4 text-right font-mono tabular-nums">
                {c.wasteShare === null ? <span className="text-muted-foreground">running</span> : `${marker(c.basis)}${percent(c.wasteShare)}`}
              </td>
              <td className="py-2 pr-4 text-muted-foreground">
                {c.basis === "estimated" ? "Estimated" : "Measured"}
                {c.lowConfidence ? ", low confidence" : ""}
                {c.inferred ? ", dates inferred" : ""}
              </td>
              <td className="py-2 text-muted-foreground">
                {c.limitHits.length === 0
                  ? "none"
                  : `${c.limitHits.length}, blocked ${blockedText(blockedTotal(c))}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HitMark() {
  return (
    <span className="grid size-3.5 place-items-center rounded-full bg-foreground text-background" aria-hidden>
      <X className="size-2.5" strokeWidth={3} />
    </span>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-8 w-40" />
      <div className="flex items-end gap-3" style={{ height: PLOT_HEIGHT }}>
        {[0.6, 0.8, 0.5, 0.7].map((h, i) => (
          <Skeleton key={i} className="flex-1 opacity-50" style={{ height: `${h * 100}%` }} />
        ))}
      </div>
    </div>
  );
}

/** "24 Sep – 1 Oct", "from 1 Oct, resets 8 Oct", "until 1 Oct". */
function span(c: HistoryCycle): string {
  const from = c.from ? dayMonth(c.from) : null;
  const to = c.resetAt ? dayMonth(c.resetAt) : null;
  if (c.running) return [from && `Since ${from}`, to && `resets ${to}`].filter(Boolean).join(", ") || "Running Cycle";
  if (from && to) return `${from} to ${to}`;
  return to ? `Until ${to}` : "Cycle";
}

function summary(c: HistoryCycle): string {
  const m = marker(c.basis);
  const parts = [span(c), `${m}${percent(c.usedShare)} used`];
  if (c.wasteShare !== null) parts.push(`${m}${percent(c.wasteShare)} wasted`);
  if (c.limitHits.length) parts.push(`${c.limitHits.length} Limit Hit${c.limitHits.length > 1 ? "s" : ""}`);
  return parts.join(", ");
}

/** A solid fill, or for Estimated values a 45° hatch of the same color over a pale tint. */
function fill(color: string, estimated?: boolean): React.CSSProperties {
  return estimated ? hatch(color) : { background: color };
}

function hatch(color: string, neutral = false): React.CSSProperties {
  return {
    backgroundColor: neutral ? "transparent" : `color-mix(in oklab, ${color} 28%, transparent)`,
    backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 5px)`,
  };
}
