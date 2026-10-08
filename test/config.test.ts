import { expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";

test("defaults: per-user data directory and OpenUsage on localhost", () => {
  const config = loadConfig({}, "/home/someone");
  expect(config.dataDir).toBe("/home/someone/Library/Application Support/usage-insights");
  expect(config.dbPath).toBe("/home/someone/Library/Application Support/usage-insights/usage.db");
  expect(config.openUsageUrl).toBe("http://127.0.0.1:6736/v1/usage");
});

test("environment overrides the data directory and the OpenUsage URL", () => {
  const config = loadConfig(
    {
      USAGE_INSIGHTS_DATA_DIR: "/tmp/ui-data",
      USAGE_INSIGHTS_OPENUSAGE_URL: "http://127.0.0.1:9999/v1/usage",
    },
    "/home/someone",
  );
  expect(config.dataDir).toBe("/tmp/ui-data");
  expect(config.dbPath).toBe("/tmp/ui-data/usage.db");
  expect(config.openUsageUrl).toBe("http://127.0.0.1:9999/v1/usage");
});

test("Codex session logs: ~/.codex/sessions unless USAGE_INSIGHTS_CODEX_DIR says otherwise", () => {
  expect(loadConfig({}, "/home/someone").codexSessionsDir).toBe("/home/someone/.codex/sessions");
  expect(loadConfig({ USAGE_INSIGHTS_CODEX_DIR: "/tmp/codex" }, "/home/someone").codexSessionsDir).toBe("/tmp/codex");
});
