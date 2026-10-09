"use client";

import type { AnalyticsSectionProps } from "@/components/analytics/types";
import { SectionSlot } from "@/components/section";

/**
 * SLOT (#20): per plan, one stacked bar per Cycle (used vs wasted) with Limit Hits marked;
 * Estimated values hatched and marked "~" (`GET /api/history/:provider`). Replace this body.
 */
export function WasteHistory(_props: AnalyticsSectionProps) {
  return (
    <SectionSlot title="Waste and Limit history" ticket="#20">
      Used and wasted share of every Cycle, with Limit Hits.
    </SectionSlot>
  );
}
