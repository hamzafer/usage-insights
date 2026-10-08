import type { ClaudeClient } from "./claude-suggestions.ts";

/**
 * The real Claude behind `ClaudeClient`: one Messages API call (raw HTTP, no SDK dependency).
 * The API key is read when a call is made and only ever sent in the `x-api-key` header; error
 * messages never contain it.
 */

export const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
/** Chosen from the current model docs at build time (claude-api skill, 2026-10): Claude Sonnet 5.5. */
export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_TIMEOUT_MS = 60_000;
/** The personal Anthropic API key's Keychain service (spec §6). */
export const KEYCHAIN_SERVICE = "anthropic-api-key-personal";

export interface AnthropicClientOptions {
  /** Called once per request; throws when no key is found. */
  apiKey: () => string;
  model?: string;
  url?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const SCHEMA = {
  type: "object",
  properties: { suggestions: { type: "array", items: { type: "string" } } },
  required: ["suggestions"],
  additionalProperties: false,
};

export class AnthropicClient implements ClaudeClient {
  constructor(private readonly options: AnthropicClientOptions) {}

  async ask(prompt: { system: string; user: string }): Promise<string> {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const doFetch = this.options.fetch ?? fetch;
    const body = {
      model: this.options.model ?? DEFAULT_MODEL,
      max_tokens: 4000,
      // Sonnet 5.5: no prefill, no `thinking: disabled`, no sampling parameters (all 400).
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    };
    const apiKey = this.options.apiKey();
    let response: Response;
    try {
      response = await doFetch(this.options.url ?? MESSAGES_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        throw new Error(`Claude API did not answer within ${timeoutMs / 1000}s`);
      }
      throw new Error(`Claude API unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }

    const data = (await response.json().catch(() => null)) as MessageResponse | null;
    if (!response.ok) {
      const detail = data?.error?.message ?? response.statusText;
      throw new Error(`Claude API error (HTTP ${response.status}): ${detail}`.slice(0, 300));
    }
    if (!data) throw new Error("Claude API returned no JSON");
    if (data.stop_reason === "refusal") throw new Error("Claude declined to answer");
    if (data.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off");
    return (data.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
  }
}

interface MessageResponse {
  stop_reason?: string;
  content?: { type: string; text?: string }[];
  error?: { type?: string; message?: string };
}

/** ANTHROPIC_API_KEY (tests, CI) wins; else the macOS Keychain item. */
export function readApiKey(
  env: Record<string, string | undefined> = process.env,
  keychain: (service: string) => string | null = readKeychain,
): string {
  const key = env.ANTHROPIC_API_KEY || keychain(KEYCHAIN_SERVICE);
  if (!key) {
    throw new Error(`Anthropic API key not found: no ANTHROPIC_API_KEY and no Keychain item ${KEYCHAIN_SERVICE}`);
  }
  return key;
}

/** `security find-generic-password -s <service> -w`; null when missing (output never logged). */
export function readKeychain(service: string): string | null {
  try {
    const proc = Bun.spawnSync(["security", "find-generic-password", "-s", service, "-w"], { stderr: "ignore" });
    if (proc.exitCode !== 0) return null;
    return proc.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}
