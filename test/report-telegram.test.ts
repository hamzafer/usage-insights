import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fitTelegram, loadTelegramCredentials, TELEGRAM_TEXT_LIMIT, TelegramMessenger } from "../src/report/telegram.ts";

// Fake values only, never real ones.
const TOKEN = "123456:FAKE";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-insights-telegram-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeState(stateDir: string, env: string, access: unknown) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, ".env"), env);
  writeFileSync(join(stateDir, "access.json"), JSON.stringify(access));
}

test("reads the token and chat id from the Telegram state directory at runtime", () => {
  writeState(dir, `TELEGRAM_BOT_TOKEN="${TOKEN}"\n`, { dmPolicy: "allowlist", allowFrom: ["1"] });
  expect(loadTelegramCredentials({ TELEGRAM_STATE_DIR: dir }, "/nowhere")).toEqual({ token: TOKEN, chatId: "1" });
});

test("finds the state directory under the Claude config dir, and env values win", () => {
  writeState(join(dir, "channels", "telegram"), `TELEGRAM_BOT_TOKEN=${TOKEN}\n`, { allowFrom: ["7"] });
  expect(loadTelegramCredentials({ CLAUDE_CONFIG_DIR: dir }, "/nowhere")).toEqual({ token: TOKEN, chatId: "7" });
  expect(
    loadTelegramCredentials(
      { CLAUDE_CONFIG_DIR: dir, TELEGRAM_BOT_TOKEN: "9:ENV", USAGE_INSIGHTS_TELEGRAM_CHAT_ID: "42" },
      "/nowhere",
    ),
  ).toEqual({ token: "9:ENV", chatId: "42" });
});

test("a missing token or chat id names the file and key, never a value", () => {
  writeState(dir, "OTHER=1\n", { allowFrom: [] });
  expect(() => loadTelegramCredentials({ TELEGRAM_STATE_DIR: dir }, "/nowhere")).toThrow(/TELEGRAM_BOT_TOKEN.*\.env/);
  writeState(dir, `TELEGRAM_BOT_TOKEN=${TOKEN}\n`, { allowFrom: [] });
  expect(() => loadTelegramCredentials({ TELEGRAM_STATE_DIR: dir }, "/nowhere")).toThrow(/allowFrom.*access\.json/);
});

test("sends one sendMessage call with the chat id and the HTML text", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const messenger = new TelegramMessenger(
    () => ({ token: TOKEN, chatId: "1" }),
    async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json({ ok: true, result: {} });
    },
  );
  await messenger.send("hello");
  expect(calls).toEqual([
    {
      url: `https://api.telegram.org/bot${TOKEN}/sendMessage`,
      body: { chat_id: "1", text: "hello", parse_mode: "HTML", disable_web_page_preview: true },
    },
  ]);
});

test("a failed send reports Telegram's description and never the token", async () => {
  const rejected = new TelegramMessenger(
    () => ({ token: TOKEN, chatId: "1" }),
    async () => Response.json({ ok: false, description: "Bad Request: chat not found" }, { status: 400 }),
  );
  const err = await rejected.send("x").catch((e: unknown) => e);
  expect(String(err)).toContain("chat not found");

  const unreachable = new TelegramMessenger(
    () => ({ token: TOKEN, chatId: "1" }),
    async (url) => {
      throw new Error(`connect failed for ${String(url)}`);
    },
  );
  const err2 = await unreachable.send("x").catch((e: unknown) => e);
  expect(String(err2)).toContain("connect failed");
  expect(String(err2)).not.toContain(TOKEN);
});

test("text over Telegram's 4096-character cap is cut, not rejected", async () => {
  const sent: string[] = [];
  const messenger = new TelegramMessenger(
    () => ({ token: TOKEN, chatId: "1" }),
    async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)).text);
      return Response.json({ ok: true });
    },
  );
  await messenger.send("a".repeat(5000));
  expect(TELEGRAM_TEXT_LIMIT).toBe(4096);
  expect(sent[0]!.length).toBeLessThanOrEqual(4096);
  expect(sent[0]!.endsWith("(cut)")).toBe(true);
});

test("cutting HTML keeps it valid: whole lines only, open tags closed", () => {
  const text = `<b>Head</b>\n<blockquote expandable>${"line &amp; more\n".repeat(400)}</blockquote>`;
  const cut = fitTelegram(text);
  expect(cut.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
  expect(cut).toEndWith("(cut)</blockquote>");
  expect(cut).not.toContain("&amp\n");
  expect(fitTelegram("<b>short</b>")).toBe("<b>short</b>");
});
