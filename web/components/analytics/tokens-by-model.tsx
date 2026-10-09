"use client";

import type { AnalyticsSectionProps } from "@/components/analytics/types";
import { SectionSlot } from "@/components/section";

/**
 * SLOT (#19): tokens per day, one line per model, 9 or more models fold into "Other"
 * (`GET /api/tokens/daily?range=`). Replace this component's body.
 */
export function TokensByModel(_props: AnalyticsSectionProps) {
  return (
    <SectionSlot title="Tokens by model" ticket="#19">
      Tokens per day for each model.
    </SectionSlot>
  );
}
