/**
 * Provider identity in the UI: display name and categorical color, fixed per Provider (never by
 * rank, never cycled). Order and hues follow the dataviz reference palette (orange, violet, aqua,
 * yellow, magenta), validated with its validator for the light card (#ffffff) and the dark card
 * (zinc, ~#0f0f11): every adjacent pair clears the CVD target (ΔE ≥ 8) and normal-vision floor
 * (ΔE ≥ 15). On light, aqua, yellow and magenta sit below 3:1 contrast, so a Provider color never
 * stands alone: it always comes with the Provider's name (legend, label or table).
 *
 * The values live as CSS variables in app/globals.css (`--provider-<id>`); use `providerColor`.
 */

export const PROVIDER_ORDER = ["claude", "claude-work", "codex", "cursor", "copilot"] as const;

const NAMES: Record<string, string> = {
  claude: "Claude",
  "claude-work": "Claude (Work)",
  codex: "Codex",
  cursor: "Cursor",
  copilot: "Copilot",
};

/** Display name as OpenUsage shows it (src/names.ts); an unknown id shows as is. */
export function providerName(id: string): string {
  return NAMES[id] ?? id;
}

/** The Provider's color as a CSS value; an unknown Provider gets the neutral "other" gray. */
export function providerColor(id: string): string {
  return (PROVIDER_ORDER as readonly string[]).includes(id) ? `var(--provider-${id})` : "var(--provider-other)";
}

/** Sorts Provider ids in the fixed order; unknown ones last, by name. */
export function byProviderOrder(a: string, b: string): number {
  const rank = (id: string) => {
    const i = (PROVIDER_ORDER as readonly string[]).indexOf(id);
    return i < 0 ? PROVIDER_ORDER.length : i;
  };
  return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
}
