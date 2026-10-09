"use client";

import { Fragment } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { lastWeekLine } from "@/lib/last-week";

/**
 * The quiet "Last week" row under the hero: Cycles that reset, Limit Hits and Overage over the
 * Report's week (the Telegram card's "✅ Last week"). Text only, no chart: it is a recap, not a figure.
 */
export function LastWeekRow() {
  const week = useApi(api.lastWeek);

  if (week.status === "loading") {
    return (
      <div className="flex items-center gap-3 px-1" aria-busy="true" aria-label="Loading last week">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
    );
  }
  if (week.status === "error") {
    return <p className="px-1 text-sm text-muted-foreground">Last week: could not load ({week.error.message})</p>;
  }

  const line = lastWeekLine(week.data);
  const items = [...line.cycles, line.limitHits, line.overage];
  return (
    // A wrapping row: each item stays whole, and long weeks wrap between items, never off the page.
    <p className="flex flex-wrap items-baseline gap-x-2 px-1 text-sm leading-6 text-muted-foreground" aria-label="Last week">
      <span className="mr-1 font-medium whitespace-nowrap text-foreground">Last week</span>
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <span aria-hidden className="text-muted-foreground/50">
              ·
            </span>
          ) : null}
          <span className="tabular-nums">{item}</span>
        </Fragment>
      ))}
    </p>
  );
}
