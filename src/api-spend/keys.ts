import { KEYCHAIN_SERVICE } from "../report/anthropic-client.ts";

/** The Key name of a Keychain service: `anthropic-api-key-<name>` is `<name>`; any other service is kept as given. */
export function keyNameFromService(service: string): string {
  const prefix = "anthropic-api-key-";
  return service.startsWith(prefix) && service.length > prefix.length ? service.slice(prefix.length) : service;
}

/** The Key the Report's own calls use: `env` when ANTHROPIC_API_KEY is set (see readApiKey), else the Keychain item's name. */
export function reportKeyName(env: Record<string, string | undefined> = process.env): string {
  return env.ANTHROPIC_API_KEY ? "env" : keyNameFromService(KEYCHAIN_SERVICE);
}
