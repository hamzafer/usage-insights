"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isRange, RANGES, type Range } from "@/lib/range";

/** One range control for every Analytics section that uses a range (filters in one row, above). */
export function RangeToggle({ value, onChange }: { value: Range; onChange: (range: Range) => void }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      onValueChange={(v) => isRange(v) && onChange(v)}
      aria-label="Range"
    >
      {RANGES.map((r) => (
        <ToggleGroupItem key={r} value={r} className="px-3 font-mono text-xs data-[state=on]:text-foreground">
          {r}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
