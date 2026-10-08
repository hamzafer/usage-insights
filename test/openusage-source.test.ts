import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenUsageSource } from "../src/openusage-source.ts";
import { record } from "../src/recorder.ts";
import { openStore } from "../src/store.ts";

// Synthetic, secrets-free fixture shaped like OpenUsage's GET /v1/usage (ADR 0002).
const fixture = await Bun.file(new URL("./fixtures/openusage-v1-usage.json", import.meta.url)).text();

let respond: () => Response = () => new Response(fixture);
const server = Bun.serve({ port: 0, fetch: () => respond() });
const url = `http://127.0.0.1:${server.port}/v1/usage`;
afterAll(() => server.stop(true));

describe("OpenUsageSource", () => {
  test("reads one ProviderReading per card with only its progress lines", async () => {
    respond = () => new Response(fixture);
    const readings = await new OpenUsageSource(url).fetch();

    expect(readings.map((r) => r.providerId)).toEqual([
      "claude",
      "claude-work",
      "codex",
      "cursor",
      "copilot",
    ]);
    expect(readings[0]).toEqual({
      providerId: "claude",
      displayName: "Claude",
      plan: "Pro",
      fetchedAt: "2026-01-05T10:00:01.123456Z",
      lines: [
        {
          label: "Session",
          used: 25,
          limit: 100,
          unit: "percent",
          resetsAt: "2026-01-05T13:00:00.111Z",
          periodMs: 18_000_000,
        },
        {
          label: "Weekly",
          used: 40,
          limit: 100,
          unit: "percent",
          resetsAt: "2026-01-09T08:00:00.111Z",
          periodMs: 604_800_000,
        },
      ],
    });
  });

  test("units come from the line format: dollars, and a count's suffix", async () => {
    respond = () => new Response(fixture);
    const readings = await new OpenUsageSource(url).fetch();
    const units = readings.flatMap((r) => r.lines.map((l) => `${r.providerId}/${l.label}=${l.unit}`));

    expect(units).toContain("claude-work/Extra usage spent=dollars");
    expect(units).toContain("codex/Workspace Credits=credits");
  });

  test("an HTTP error fails with the status", async () => {
    respond = () => new Response("nope", { status: 503 });
    await expect(new OpenUsageSource(url).fetch()).rejects.toThrow("OpenUsage returned HTTP 503");
  });

  test("a response that is not a list of cards fails", async () => {
    respond = () => new Response(JSON.stringify({ error: "x" }));
    await expect(new OpenUsageSource(url).fetch()).rejects.toThrow("unexpected response shape");
  });

  test("an unreachable API fails", async () => {
    const closed = Bun.serve({ port: 0, fetch: () => new Response() });
    const deadUrl = `http://127.0.0.1:${closed.port}/v1/usage`;
    closed.stop(true);
    await expect(new OpenUsageSource(deadUrl).fetch()).rejects.toThrow();
  });
});

describe("recording the OpenUsage fixture", () => {
  test("stores every progress line, each with a known role", async () => {
    respond = () => new Response(fixture);
    const dir = mkdtempSync(join(tmpdir(), "usage-insights-test-"));
    const store = openStore(join(dir, "usage.db"));
    try {
      const result = await record(new OpenUsageSource(url), store);
      expect(result).toEqual({ ok: true, stored: 14 });
      expect(store.latestReadings().filter((r) => r.role === "unclassified")).toEqual([]);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
