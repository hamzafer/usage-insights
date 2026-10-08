import { expect, test } from "bun:test";
import { basisOfSource, CALIBRATED_PROVIDER_IDS, LIVE_SOURCE, providerInfo } from "../src/providers.ts";

test("one registry entry per Provider: name, line roles, Overage units, calibration", () => {
  expect(providerInfo("claude-work")).toMatchObject({
    displayName: "Claude (Work)",
    lines: { "Extra usage spent": "overage" },
    overageUnits: { "Extra usage spent": "$" },
    calibrated: true,
  });
  expect(providerInfo("someone-new")).toBeUndefined();
  expect(CALIBRATED_PROVIDER_IDS).toEqual(["claude", "claude-work"]);
});

test("Claude Backfill readings are Estimated; live Snapshots and Codex Backfill readings are Measured", () => {
  expect(basisOfSource("backfill:claude")).toBe("estimated");
  expect(basisOfSource("backfill:claude-work")).toBe("estimated");
  expect(basisOfSource("backfill:codex")).toBe("measured");
  expect(basisOfSource(LIVE_SOURCE)).toBe("measured");
});
