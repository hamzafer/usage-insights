"use client";

import { Section } from "@/components/section";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { apiSpendRows } from "@/lib/api-spend";

// One grid for the header, Keys and Callers, so their numbers line up; the name column takes the
// rest and wraps, so the row never scrolls sideways on a phone.
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_4.25rem_4.25rem_2.75rem] items-baseline gap-x-3 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_3.5rem]";
const NUMBER = "text-right font-mono tabular-nums";

/**
 * "Claude API" under the Last week row: API Spend per Key (7 and 30 days, calls) with its Callers
 * beneath. Quiet on purpose: text rows, no chart, so the hero stays the figure of the page. Only
 * calls from the user's own tools are counted (ADR 0004), which the footnote says.
 */
export function ApiSpend() {
  const spend = useApi(api.apiSpend);

  if (spend.status === "loading") {
    return (
      <Section title="Claude API">
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading Claude API spend">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3 opacity-60" />
          <Skeleton className="h-4 w-full" />
        </div>
      </Section>
    );
  }
  if (spend.status === "error") {
    return (
      <Section title="Claude API">
        <p className="text-sm text-muted-foreground">Could not load ({spend.error.message})</p>
      </Section>
    );
  }

  const rows = apiSpendRows(spend.data);
  return (
    <Section title="Claude API">
      <div className="flex flex-col gap-3 text-[13px]">
        <div className={`${COLUMNS} text-xs text-muted-foreground`} aria-hidden>
          <span>Key</span>
          <span className="text-right">7 days</span>
          <span className="text-right">30 days</span>
          <span className="text-right">Calls</span>
        </div>
        {rows.map((row) => (
          <div key={row.key} className="flex flex-col gap-1.5 border-t pt-3">
            <div className={COLUMNS}>
              <span className="truncate font-medium">{row.key}</span>
              {row.noCalls ? (
                <span className="col-span-3 text-right text-muted-foreground">no calls</span>
              ) : (
                <>
                  <span className={NUMBER}>{row.last7d}</span>
                  <span className={NUMBER}>{row.last30d}</span>
                  <span className={NUMBER}>{row.calls}</span>
                </>
              )}
            </div>
            {row.callers.map((c) => (
              <div key={`${c.label}/${c.model}`} className={`${COLUMNS} text-muted-foreground`}>
                <span className="min-w-0 pl-3">
                  {c.label} <span className="whitespace-nowrap text-muted-foreground/70">{c.model}</span>
                </span>
                <span className={NUMBER}>{c.last7d}</span>
                <span className={NUMBER}>{c.last30d}</span>
                <span className={NUMBER}>{c.calls}</span>
              </div>
            ))}
          </div>
        ))}
        <p className="border-t pt-3 text-xs text-muted-foreground">
          Only calls from your own tools. The Anthropic Console shows every key.
        </p>
      </div>
    </Section>
  );
}
