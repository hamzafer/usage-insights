import { priceUsage } from "../api-prices.ts";
import type { AnthropicUsage } from "../report/anthropic-client.ts";
import type { Store } from "../store.ts";

/**
 * Records the Report's own Claude calls as API Spend (caller `suggestions`): the `onUsage` hook of
 * AnthropicClient. A failure to record is logged and never thrown, so it cannot fail the Report.
 * Only token counts and the cost are stored, never the key.
 */
export function suggestionsRecorder(deps: {
  store: Pick<Store, "addApiSpend">;
  key: string;
  now: () => Date;
  timeZone?: string;
  log: (line: string) => void;
}): (usage: AnthropicUsage) => void {
  return ({ model, usage }) => {
    try {
      const at = deps.now();
      deps.store.addApiSpend({
        day: localDate(at, deps.timeZone),
        key: deps.key,
        caller: "suggestions",
        model,
        calls: 1,
        ...priceUsage(model, usage),
        updatedAt: at.toISOString(),
      });
    } catch (e) {
      deps.log(`Could not record API spend: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}

/** YYYY-MM-DD in the given (else the machine's) time zone. */
export function localDate(at: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
