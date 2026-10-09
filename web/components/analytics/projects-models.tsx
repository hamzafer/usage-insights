"use client";

import { useCallback, useState } from "react";
import type { AnalyticsSectionProps } from "@/components/analytics/types";
import { ProviderTabs } from "@/components/provider-tabs";
import { ApiErrorState, EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { compactNumber, percent } from "@/lib/format";
import { byProviderOrder, providerColor, providerName } from "@/lib/providers";
import type { ProviderRanking, RankedShare } from "@/lib/types";

/** Rows shown before "Show N more". */
const TOP = 8;

/**
 * Projects and models (#18): where a Provider's tokens went in the range, as two ranked lists with
 * a proportional bar behind each row (Vercel Analytics style). Tabs pick the Provider; only
 * Providers with token logs get one. Bars scale to the largest row, so the leader fills the row.
 */
export function ProjectsModels({ range }: AnalyticsSectionProps) {
  const load = useCallback((init?: RequestInit) => api.projects(range, init), [range]);
  const state = useApi(load);
  const [picked, setPicked] = useState<string | null>(null);

  if (state.status === "loading") return <ProjectsModelsSkeleton />;
  if (state.status === "error") {
    return (
      <Frame>
        <ApiErrorState error={state.error} onRetry={state.reload} />
      </Frame>
    );
  }

  const providers = state.data.providers.toSorted((a, b) => byProviderOrder(a.provider, b.provider));
  if (providers.length === 0) {
    return (
      <Frame>
        <EmptyState title="No token logs read yet">
          Read the Claude Code and Codex logs with{" "}
          <code className="font-mono text-foreground">bun run backfill:tokens</code>, then reload. Projects and models
          show up here.
        </EmptyState>
      </Frame>
    );
  }

  const current = providers.find((p) => p.provider === picked) ?? providers[0]!;
  const days = range === "7d" ? "7 days" : "30 days";

  return (
    <Frame
      description={
        current.total > 0
          ? `${compactNumber(current.total)} tokens in the last ${days}`
          : `No ${providerName(current.provider)} tokens in the last ${days}`
      }
      actions={
        providers.length > 1 ? (
          <ProviderTabs providers={providers.map((p) => p.provider)} value={current.provider} onChange={setPicked} />
        ) : (
          <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: providerColor(current.provider) }} />
            {providerName(current.provider)}
          </span>
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <RankedCard key={`projects-${current.provider}`} title="Projects" noun="Projects" ranking={current} rows={current.projects} />
        <RankedCard key={`models-${current.provider}`} title="Models" noun="models" ranking={current} rows={current.models} />
      </div>
    </Frame>
  );
}

/** The section's heading row over its cards; the cards themselves are the surfaces. */
function Frame({
  description,
  actions,
  children,
}: {
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby="projects-models-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-[1_1_12rem]">
          <h2 id="projects-models-title" className="text-sm font-medium">
            Projects and models
          </h2>
          {description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function RankedCard({
  title,
  noun,
  ranking,
  rows,
}: {
  title: string;
  /** For "N more <noun>". */
  noun: string;
  ranking: ProviderRanking;
  rows: RankedShare[];
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, TOP);
  const hidden = rows.length - shown.length;
  const max = rows[0]?.tokens ?? 0;
  const color = providerColor(ranking.provider);

  return (
    <div className="flex min-w-0 flex-col rounded-xl border bg-card text-card-foreground">
      <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground">Tokens</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 pt-2 pb-5 text-[13px] text-muted-foreground">Nothing in this range.</p>
      ) : (
        <ol aria-label={`${title} by tokens`} className="flex flex-col gap-0.5 px-2 pb-2">
          {shown.map((row) => (
            <li key={row.name}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    tabIndex={0}
                    className="group relative flex h-8 items-center gap-3 overflow-hidden rounded-md px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 rounded-[4px] opacity-[0.16] transition-opacity group-hover:opacity-[0.26] dark:opacity-[0.28] dark:group-hover:opacity-[0.4]"
                      style={{ width: `${max > 0 ? Math.max((row.tokens / max) * 100, 1) : 0}%`, backgroundColor: color }}
                    />
                    <span className="relative min-w-0 flex-1 truncate" title={row.label === row.name ? undefined : row.name}>
                      {row.label}
                    </span>
                    <span className="relative shrink-0 font-medium tabular-nums">{compactNumber(row.tokens)}</span>
                    <span className="relative w-9 shrink-0 text-right text-muted-foreground tabular-nums">
                      {sharePercent(row.share)}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" align="start">
                  <span className="font-medium">{row.label}</span>
                  {row.label !== row.name ? <span className="opacity-70"> ({row.name})</span> : null}
                  <br />
                  {row.tokens.toLocaleString("en-US")} tokens, {sharePercent(row.share)} of{" "}
                  {providerName(ranking.provider)}
                </TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ol>
      )}
      {rows.length > TOP ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          className="mx-2 mb-2 justify-start px-2 text-[13px] font-normal text-muted-foreground"
          aria-expanded={expanded}
        >
          {expanded ? "Show fewer" : `${hidden} more ${noun}`}
        </Button>
      ) : null}
    </div>
  );
}

function ProjectsModelsSkeleton() {
  return (
    <Frame>
      <div className="grid gap-4 sm:grid-cols-2" aria-busy="true" aria-label="Loading Projects and models">
        {[0, 1].map((card) => (
          <div key={card} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <Skeleton className="mb-2 h-4 w-20" />
            {[100, 72, 48, 30, 18].map((w) => (
              <Skeleton key={w} className="h-6 opacity-60" style={{ width: `${w}%` }} />
            ))}
          </div>
        ))}
      </div>
    </Frame>
  );
}


/** Like `percent`, but a small non-zero share reads "<1%" instead of "0%". */
function sharePercent(share: number): string {
  return share > 0 && share < 0.005 ? "<1%" : percent(share);
}
