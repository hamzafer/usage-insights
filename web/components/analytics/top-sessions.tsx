"use client";

import type { AnalyticsSectionProps } from "@/components/analytics/types";
import { SectionSlot } from "@/components/section";

/**
 * SLOT (#21): the biggest sessions in the range with tokens, % of the 5-hour limit and % of the
 * weekly limit (`GET /api/sessions/top?range=`). Replace this component's body.
 */
export function TopSessions(_props: AnalyticsSectionProps) {
  return (
    <SectionSlot title="Top sessions" ticket="#21">
      The biggest sessions in the range and how much of each limit they took.
    </SectionSlot>
  );
}
