"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { providerColor, providerName } from "@/lib/providers";

/** The value of the "All" tab. */
export const ALL_PROVIDERS = "all";

/**
 * The one Provider filter of the app: shadcn Tabs, one per Provider (its dot and name, never the
 * color alone), with an optional "All" tab first. Every section that filters by Provider uses it,
 * so the control looks and behaves the same everywhere. Scrolls sideways on a phone instead of
 * widening the page.
 */
export function ProviderTabs({
  providers,
  value,
  onChange,
  all = false,
  className,
}: {
  /** Provider ids, already in display order. */
  providers: readonly string[];
  value: string;
  onChange: (value: string) => void;
  /** Adds an "All" tab (value ALL_PROVIDERS) before the Providers. */
  all?: boolean;
  className?: string;
}) {
  return (
    <Tabs value={value} onValueChange={onChange} className={className}>
      <TabsList aria-label="Provider" className="h-8 max-w-full justify-start overflow-x-auto">
        {all ? (
          <TabsTrigger value={ALL_PROVIDERS} className="flex-none px-2.5 text-[13px]">
            All
          </TabsTrigger>
        ) : null}
        {providers.map((p) => (
          <TabsTrigger key={p} value={p} className="flex-none gap-2 px-2.5 text-[13px]">
            <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: providerColor(p) }} />
            {providerName(p)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
