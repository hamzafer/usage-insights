"use client";

import { ChartLine, Table2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { AnalyticsSectionProps } from "@/components/analytics/types";
import { ALL_PROVIDERS, ProviderTabs } from "@/components/provider-tabs";
import { Section } from "@/components/section";
import { ApiErrorState, EmptyState } from "@/components/states";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { byProviderOrder, providerName } from "@/lib/providers";
import { compactNumber } from "@/lib/format";
import {
  dayLabel,
  foldModels,
  fullTokens,
  longDayLabel,
  MODEL_SLOTS,
  type ModelSeries,
  OTHER_COLOR,
  type ProviderFilter,
  tokenRows,
  type TokensRow,
  visibleSeries,
} from "@/lib/tokens";
import type { TokensDaily } from "@/lib/types";

type View = "chart" | "table";

/**
 * Tokens per day, one line per model (ChatGPT style): headline total, legend with dots, crosshair
 * and a tooltip listing every model of the day, a table view, and Provider tabs (All first).
 * `GET /api/tokens/daily?range=`; 9 or more models fold into "Other" (lib/tokens.ts).
 */
export function TokensByModel({ range }: AnalyticsSectionProps) {
  const load = useCallback((init?: RequestInit) => api.tokensDaily(range, init), [range]);
  const tokens = useApi(load);
  const [filter, setFilter] = useState<ProviderFilter>(ALL_PROVIDERS);
  const [view, setView] = useState<View>("chart");

  const providers = tokens.data ? [...tokens.data.providers].toSorted(byProviderOrder) : [];
  const actions =
    tokens.status === "ready" && tokens.data.models.length > 0 ? (
      <div className="flex items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={view}
          onValueChange={(v) => (v === "chart" || v === "table") && setView(v)}
          aria-label="View"
        >
          <ToggleGroupItem value="chart" aria-label="Chart view" className="px-2">
            <ChartLine aria-hidden />
          </ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="Table view" className="px-2">
            <Table2 aria-hidden />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    ) : null;

  return (
    <Section id="tokens-by-model" className="min-w-0" title="Tokens by model" description="Tokens per day, as logged" actions={actions}>
      {tokens.status === "loading" ? (
        <LoadingBody />
      ) : tokens.status === "error" ? (
        <ApiErrorState error={tokens.error} onRetry={tokens.reload} />
      ) : tokens.data.models.length === 0 ? (
        <EmptyState title="No tokens in the last 30 days">
          Read the Claude and Codex logs with <code className="font-mono text-foreground">bun run backfill:tokens</code>.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {providers.length > 1 ? (
            <ProviderTabs all providers={providers} value={providers.includes(filter) ? filter : ALL_PROVIDERS} onChange={setFilter} />
          ) : null}
          <TokensBody data={tokens.data} filter={providers.includes(filter) ? filter : ALL_PROVIDERS} view={view} />
        </div>
      )}
    </Section>
  );
}

function TokensBody({ data, filter, view }: { data: TokensDaily; filter: ProviderFilter; view: View }) {
  const series = useMemo(() => foldModels(data.models), [data.models]);
  const rows = useMemo(() => tokenRows(data, series, filter), [data, series, filter]);
  const shown = visibleSeries(series, rows);
  const total = rows.reduce((sum, r) => sum + r.total, 0);
  const config = useMemo(
    () =>
      Object.fromEntries(
        series.map((s) => [
          s.key,
          s.slot === null ? { label: s.name, color: OTHER_COLOR } : { label: s.name, theme: MODEL_SLOTS[s.slot]! },
        ]),
      ) satisfies ChartConfig,
    [series],
  );

  return (
    // The series colors as `--color-<key>` for the legend, chart and table alike (both themes).
    <div className="flex flex-col gap-4" data-tokens-colors="">
      <ColorVars config={config} />
      <div>
        <p className="text-[13px] text-muted-foreground">Total tokens</p>
        <p className="font-mono text-2xl font-medium tracking-tight tabular-nums">{fullTokens(total)}</p>
      </div>
      {shown.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted-foreground">
          No tokens from {providerName(filter)} in this range.
        </p>
      ) : (
        <>
          <Legend series={shown} />
          {view === "chart" ? (
            <TokensChart rows={rows} series={shown} config={config} />
          ) : (
            <TokensTable rows={rows} series={shown} />
          )}
        </>
      )}
    </div>
  );
}

function Legend({ series }: { series: ModelSeries[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]" aria-label="Models">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <Dot seriesKey={s.key} />
          <span className="text-muted-foreground">{s.name}</span>
        </li>
      ))}
    </ul>
  );
}

function Dot({ seriesKey }: { seriesKey: string }) {
  return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: `var(--color-${seriesKey})` }} />;
}

function TokensChart({ rows, series, config }: { rows: TokensRow[]; series: ModelSeries[]; config: ChartConfig }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full" aria-label="Tokens per day by model, line chart">
      <LineChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} strokeDasharray="0" className="[&_line]:stroke-border" />
        <XAxis
          dataKey="date"
          tickFormatter={dayLabel}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          className="font-mono text-[11px]"
        />
        <YAxis
          tickFormatter={compactNumber}
          tickLine={false}
          axisLine={false}
          width={44}
          tickCount={4}
          className="font-mono text-[11px]"
        />
        <ChartTooltip
          cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }}
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as TokensRow | undefined;
            return active && row ? <DayTooltip row={row} series={series} /> : null;
          }}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.name}
            type="monotone"
            stroke={`var(--color-${s.key})`}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

/** Every model of the hovered day, largest first, with the day's total. */
function DayTooltip({ row, series }: { row: TokensRow; series: ModelSeries[] }) {
  const items = series
    .map((s) => ({ s, tokens: (row[s.key] as number | undefined) ?? 0 }))
    .toSorted((a, b) => b.tokens - a.tokens);
  return (
    <div className="min-w-48 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1.5 flex items-baseline justify-between gap-4">
        <span className="font-medium">{longDayLabel(row.date)}</span>
        <span className="font-mono tabular-nums">{fullTokens(row.total)}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map(({ s, tokens }) => (
          <li key={s.key} className="flex items-center gap-2">
            <Dot seriesKey={s.key} />
            <span className="flex-1 text-muted-foreground">{s.name}</span>
            <span className="font-mono tabular-nums">{fullTokens(tokens)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TokensTable({ rows, series }: { rows: TokensRow[]; series: ModelSeries[] }) {
  return (
    <div className="max-h-80 overflow-auto rounded-lg border">
      <table className="w-full text-[13px]">
        <caption className="sr-only">Tokens per day by model</caption>
        <thead className="sticky top-0 bg-card">
          <tr className="border-b text-left text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-normal">
              Day
            </th>
            {series.map((s) => (
              <th key={s.key} scope="col" className="px-3 py-2 text-right font-normal whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">
                  <Dot seriesKey={s.key} />
                  {s.name}
                </span>
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-right font-normal">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {rows.toReversed().map((r) => (
            <tr key={r.date} className="border-b last:border-0">
              <th scope="row" className="px-3 py-1.5 text-left font-sans font-normal whitespace-nowrap">
                {longDayLabel(r.date)}
              </th>
              {series.map((s) => (
                <td key={s.key} className="px-3 py-1.5 text-right">
                  {fullTokens((r[s.key] as number | undefined) ?? 0)}
                </td>
              ))}
              <td className="px-3 py-1.5 text-right">{fullTokens(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `--color-<key>` per series in both themes, the same values ChartContainer sets inside the chart. */
function ColorVars({ config }: { config: ChartConfig }) {
  const vars = (theme: "light" | "dark") =>
    Object.entries(config)
      .map(([key, c]) => `--color-${key}: ${c.theme?.[theme] ?? c.color};`)
      .join(" ");
  return (
    <style>{`[data-tokens-colors] { ${vars("light")} } .dark [data-tokens-colors] { ${vars("dark")} }`}</style>
  );
}

function LoadingBody() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-40" />
      </div>
      <Skeleton className="h-64 w-full opacity-50" />
    </div>
  );
}
