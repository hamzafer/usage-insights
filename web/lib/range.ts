/** The Analytics range toggle (spec: 7d / 30d where it applies); `?range=` on the API. */
export const RANGES = ["7d", "30d"] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = "7d";

export function isRange(value: string): value is Range {
  return (RANGES as readonly string[]).includes(value);
}
