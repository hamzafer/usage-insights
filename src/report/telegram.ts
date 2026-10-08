import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Telegram delivery for the Report (spec §6). Reuses the bot of the Claude Code Telegram plugin:
 * the token and chat id are read from its state directory at send time and never stored, copied
 * or logged. Only `sendMessage` is called: the plugin owns `getUpdates` for this bot.
 */

/** Where a Report's message goes. Tests use a fake. */
export interface Messenger {
  send(text: string): Promise<void>;
}

export interface TelegramCredentials {
  token: string;
  chatId: string;
}

/** Telegram rejects longer `sendMessage` texts. */
export const TELEGRAM_TEXT_LIMIT = 4096;
const CUT_MARK = "\n(cut)";

/**
 * The plugin's state directory: `TELEGRAM_STATE_DIR`, else `<CLAUDE_CONFIG_DIR or ~/.claude>/channels/telegram`.
 * Token: `TELEGRAM_BOT_TOKEN` from the environment, else from `.env` there.
 * Chat id: `USAGE_INSIGHTS_TELEGRAM_CHAT_ID`, else `allowFrom[0]` of `access.json` there (a DM's chat id is the user id).
 */
export function loadTelegramCredentials(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): TelegramCredentials {
  const dir = env.TELEGRAM_STATE_DIR || join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "channels", "telegram");
  const envPath = join(dir, ".env");
  const accessPath = join(dir, "access.json");

  const token = env.TELEGRAM_BOT_TOKEN || tokenFromEnvFile(envPath);
  if (!token) throw new Error(`Telegram bot token not found: no TELEGRAM_BOT_TOKEN in ${envPath}`);

  const chatId = env.USAGE_INSIGHTS_TELEGRAM_CHAT_ID || chatIdFromAccess(accessPath);
  if (!chatId) throw new Error(`Telegram chat id not found: allowFrom is empty or missing in ${accessPath}`);
  return { token, chatId };
}

function tokenFromEnvFile(path: string): string | null {
  const text = readIfExists(path);
  const line = text?.split("\n").find((l) => l.startsWith("TELEGRAM_BOT_TOKEN="));
  if (!line) return null;
  return line.slice("TELEGRAM_BOT_TOKEN=".length).trim().replace(/^(["'])(.*)\1$/, "$2") || null;
}

function chatIdFromAccess(path: string): string | null {
  const text = readIfExists(path);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Telegram access file is not valid JSON: ${path}`);
  }
  const first = (parsed as { allowFrom?: unknown }).allowFrom;
  const id = Array.isArray(first) ? first[0] : undefined;
  return id === undefined || id === null || id === "" ? null : String(id);
}

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Sends HTML (`parse_mode: "HTML"`, so callers escape their text) to the chat via the Bot API's `sendMessage`. */
export class TelegramMessenger implements Messenger {
  constructor(
    private readonly credentials: () => TelegramCredentials = () => loadTelegramCredentials(),
    private readonly fetchFn: Fetch = (url, init) => fetch(url, init),
  ) {}

  async send(text: string): Promise<void> {
    const { token, chatId } = this.credentials();
    // The token is part of the URL: keep it out of every error message.
    const redact = (s: string) => s.split(token).join("<token>");
    let res: Response;
    try {
      res = await this.fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: fitTelegram(text), parse_mode: "HTML", disable_web_page_preview: true }),
      });
    } catch (e) {
      throw new Error(`Telegram send failed: ${redact(e instanceof Error ? e.message : String(e))}`);
    }
    const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!res.ok || !body?.ok) {
      throw new Error(`Telegram send failed (HTTP ${res.status}): ${redact(body?.description ?? "no description")}`);
    }
  }
}

/**
 * Cuts HTML text to Telegram's limit, marking the cut. It cuts at a line end when it can (never
 * inside a tag or an entity) and closes the tags left open, so Telegram can still parse it.
 */
export function fitTelegram(text: string): string {
  if (text.length <= TELEGRAM_TEXT_LIMIT) return text;
  const budget = TELEGRAM_TEXT_LIMIT - CUT_MARK.length - CLOSING_ROOM;
  let cut = text.slice(0, budget);
  const lineEnd = cut.lastIndexOf("\n");
  cut = lineEnd > budget / 2 ? cut.slice(0, lineEnd) : cut.replace(/<[^>]*$/, "").replace(/&[^;\s]*$/, "");
  const open: string[] = [];
  for (const [, closing, tag] of cut.matchAll(/<(\/?)([a-z-]+)[^>]*>/gi)) {
    if (closing) open.splice(open.lastIndexOf(tag!), 1);
    else open.push(tag!);
  }
  return cut + CUT_MARK + open.toReversed().map((t) => `</${t}>`).join("");
}

/** Room kept for closing the tags left open by a cut. */
const CLOSING_ROOM = 64;
