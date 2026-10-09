"use client";

import { useState } from "react";
import { ProjectsModels } from "@/components/analytics/projects-models";
import { RangeToggle } from "@/components/analytics/range-toggle";
import { TokensByModel } from "@/components/analytics/tokens-by-model";
import { TopSessions } from "@/components/analytics/top-sessions";
import { WasteHistory } from "@/components/analytics/waste-history";
import { DEFAULT_RANGE, type Range } from "@/lib/range";

/** Analytics: one range control above the sections; each section is one component, one line here. */
export function AnalyticsPage() {
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <RangeToggle value={range} onChange={setRange} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ProjectsModels range={range} />
        <TokensByModel range={range} />
      </div>
      <WasteHistory range={range} />
      <TopSessions range={range} />
    </div>
  );
}
