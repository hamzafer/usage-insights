"use client";

import { SectionSlot } from "@/components/section";
import type { PlanTile } from "@/lib/plan-tiles";
import type { Overview } from "@/lib/types";

/** What the Overview passes the hero chart: the selected plan tile, and the overview it came from. */
export interface HeroChartProps {
  /** The selected plan; null when there are no plans. */
  plan: PlanTile | null;
  overview: Overview;
}

/**
 * SLOT (#17): the selected plan's current Cycle, % used over time, dashed Pace to the Reset, 100%
 * limit line (`GET /api/hero/:provider`). Replace this component's body.
 */
export function HeroChart({ plan }: HeroChartProps) {
  return (
    <SectionSlot title="Cycle so far" ticket="#17">
      {plan ? `${plan.name}: ` : ""}% used through the current Cycle, with Pace to the Reset and the 100% limit.
    </SectionSlot>
  );
}
