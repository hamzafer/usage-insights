import { expect, test } from "bun:test";
import { AnthropicClient, readApiKey } from "../src/report/anthropic-client.ts";

const KEY = "sk-ant-test-not-a-real-key";
const PROMPT = { system: "You review usage.", user: "Numbers here." };

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  };
  return { fn: fn as typeof fetch, calls };
}

const message = (text: string, stop_reason = "end_turn") =>
  Response.json({ type: "message", stop_reason, content: [{ type: "thinking", thinking: "" }, { type: "text", text }] });

function client(f: typeof fetch, timeoutMs = 60_000) {
  return new AnthropicClient({ apiKey: () => KEY, fetch: f, timeoutMs, model: "claude-sonnet-5-5" });
}

test("posts one Messages API request with the key in its header, asking for JSON", async () => {
  const { fn, calls } = fakeFetch(() => message('{"suggestions": []}'));
  expect(await client(fn).ask(PROMPT)).toBe('{"suggestions": []}');
  expect(calls).toHaveLength(1);
  const { url, init } = calls[0]!;
  expect(url).toBe("https://api.anthropic.com/v1/messages");
  expect(init.method).toBe("POST");
  const headers = new Headers(init.headers);
  expect(headers.get("x-api-key")).toBe(KEY);
  expect(headers.get("anthropic-version")).toBe("2023-06-01");
  expect(headers.get("content-type")).toBe("application/json");
  const body = JSON.parse(String(init.body));
  expect(body.model).toBe("claude-sonnet-5-5");
  expect(body.system).toBe(PROMPT.system);
  expect(body.messages).toEqual([{ role: "user", content: PROMPT.user }]);
  expect(body.output_config.format.type).toBe("json_schema");
  // Sonnet 5.5 rejects these with a 400.
  expect(body.temperature).toBeUndefined();
  expect(body.thinking).toBeUndefined();
});

test("an HTTP error names the status and API message, never the key", async () => {
  const { fn } = fakeFetch(() =>
    Response.json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, { status: 401 }),
  );
  const err = await client(fn).ask(PROMPT).catch((e: Error) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toBe("Claude API error (HTTP 401): invalid x-api-key");
  expect((err as Error).message).not.toContain(KEY);
});

test("a refusal or a cut-off answer is a failure", async () => {
  const refused = fakeFetch(() => message("", "refusal"));
  await expect(client(refused.fn).ask(PROMPT)).rejects.toThrow("Claude declined to answer");
  const cut = fakeFetch(() => message('{"suggestions": ["A', "max_tokens"));
  await expect(client(cut.fn).ask(PROMPT)).rejects.toThrow("Claude's answer was cut off");
});

test("no answer within the timeout is a clear failure", async () => {
  const { fn } = fakeFetch(
    (call) =>
      new Promise<Response>((_, reject) => {
        call.init.signal?.addEventListener("abort", () => reject(call.init.signal?.reason));
      }),
  );
  await expect(client(fn, 20).ask(PROMPT)).rejects.toThrow("Claude API did not answer within 0.02s");
});

test("a network failure is a failure with its reason", async () => {
  const { fn } = fakeFetch(() => {
    throw new TypeError("Unable to connect");
  });
  await expect(client(fn).ask(PROMPT)).rejects.toThrow("Claude API unreachable: Unable to connect");
});

test("the API key comes from ANTHROPIC_API_KEY, else the Keychain, else a clear error", () => {
  const keychain = (service: string) => (service === "anthropic-api-key-personal" ? "from-keychain" : null);
  expect(readApiKey({ ANTHROPIC_API_KEY: "from-env" }, keychain)).toBe("from-env");
  expect(readApiKey({}, keychain)).toBe("from-keychain");
  expect(() => readApiKey({}, () => null)).toThrow(
    "Anthropic API key not found: no ANTHROPIC_API_KEY and no Keychain item anthropic-api-key-personal",
  );
});
