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

test("the dashboard listens on port 6740 unless USAGE_INSIGHTS_PORT says otherwise", () => {
  expect(loadConfig({}, "/home/someone").dashboardPort).toBe(6740);
  expect(loadConfig({ USAGE_INSIGHTS_PORT: "7001" }, "/home/someone").dashboardPort).toBe(7001);
  expect(() => loadConfig({ USAGE_INSIGHTS_PORT: "web" }, "/home/someone")).toThrow("USAGE_INSIGHTS_PORT");
});
