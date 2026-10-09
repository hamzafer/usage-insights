"use client";

import type { AnalyticsSectionProps } from "@/components/analytics/types";
import { SectionSlot } from "@/components/section";

/**
 * SLOT (#18): Projects and models as ranked lists with a proportional bar behind each row, tabs
 * per Provider with logs (`GET /api/projects?range=`). Replace this component's body.
 */
export function ProjectsModels(_props: AnalyticsSectionProps) {
  return (
    <SectionSlot title="Projects and models" ticket="#18">
      Ranked lists of where tokens went, per Provider with logs.
    </SectionSlot>
  );
}
