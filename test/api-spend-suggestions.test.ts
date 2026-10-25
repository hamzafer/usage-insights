import { expect, test } from "bun:test";
import { keyNameFromService, reportKeyName } from "../src/api-spend/keys.ts";
import { suggestionsRecorder } from "../src/api-spend/suggestions.ts";
import type { ApiSpendRow } from "../src/store.ts";

test("a Keychain service maps to its Key name; other services are kept", () => {
  expect(keyNameFromService("anthropic-api-key-personal")).toBe("personal");
  expect(keyNameFromService("anthropic-api-key-work")).toBe("work");
  expect(keyNameFromService("some-other-service")).toBe("some-other-service");
  expect(keyNameFromService("anthropic-api-key-")).toBe("anthropic-api-key-");
});

test("the Report's Key is env when ANTHROPIC_API_KEY is set, else personal", () => {
  expect(reportKeyName({ ANTHROPIC_API_KEY: "sk-ant-fake" })).toBe("env");
  expect(reportKeyName({})).toBe("personal");
});

test("records one priced call for the local day, as the suggestions caller", () => {
  const rows: ApiSpendRow[] = [];
  const record = suggestionsRecorder({
    store: { addApiSpend: (r) => void rows.push(r) },
    key: "env",
    now: () => new Date("2026-10-25T23:30:00Z"),
    timeZone: "Asia/Tokyo",
    log: () => {},
  });
  record({ model: "claude-sonnet-5-5", usage: { input_tokens: 1_000_000, output_tokens: 0 } });
  expect(rows).toEqual([
    {
      day: "2026-10-26",
      key: "env",
      caller: "suggestions",
      model: "claude-sonnet-5-5",
      calls: 1,
      input: 1_000_000,
      cacheWrite: 0,
      cacheRead: 0,
      output: 0,
      costUsd: 2,
      updatedAt: "2026-10-25T23:30:00.000Z",
    },
  ]);
});

test("a failing store is logged, never thrown", () => {
  const logged: string[] = [];
  const record = suggestionsRecorder({
    store: {
      addApiSpend: () => {
        throw new Error("attempt to write a readonly database");
      },
    },
    key: "personal",
    now: () => new Date(),
    log: (l) => void logged.push(l),
  });
  expect(() => record({ model: "m", usage: {} })).not.toThrow();
  expect(logged).toEqual(["Could not record API spend: attempt to write a readonly database"]);
});
