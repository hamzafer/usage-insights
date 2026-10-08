import { providerInfo } from "./providers.ts";

/**
 * Display names for Providers (OpenUsage's displayName) and models, used wherever a person reads
 * them (dashboard, Report). Stored data keeps the raw ids.
 */

/** The Provider's display name from the registry (src/providers.ts); an unknown id shows as is. */
export function providerName(id: string): string {
  return providerInfo(id)?.displayName ?? id;
}

/**
 * `claude-<family>[-<major>[-<minor>]][-<yyyymmdd>]` → "Opus 5.5";
 * `gpt-<version>[-<variant>...]` → "GPT-6.1 Sol". Anything else shows as is.
 */
export function modelName(id: string): string {
  const claude = /^claude-([a-z]+)(?:-(\d+))?(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (claude) {
    const [, family, major, minor] = claude;
    const version = [major, minor].filter(Boolean).join(".");
    return [capitalize(family!), version].filter(Boolean).join(" ");
  }
  const gpt = /^gpt-(\d+(?:\.\d+)*)((?:-[a-z0-9]+)*)$/.exec(id);
  if (gpt) {
    const variant = gpt[2]!.split("-").filter(Boolean).map(capitalize);
    return [`GPT-${gpt[1]}`, ...variant].join(" ");
  }
  return id;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
