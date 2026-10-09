import type { Range } from "@/lib/range";

/** Every Analytics section gets the page's range; sections without a range ignore it. */
export interface AnalyticsSectionProps {
  range: Range;
}
