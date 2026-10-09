import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILD_LOCK, ensureExport, isExportStale, lockState } from "../src/dashboard/web-build.ts";

// Build-on-demand of the app's export (ADR 0003): one build at a time, staleness from the build's start.
let web: string;
const at = (iso: string) => new Date(iso);
const touch = (path: string, iso: string) => utimesSync(path, at(iso), at(iso));

beforeEach(() => {
  web = mkdtempSync(join(tmpdir(), "usage-insights-build-"));
  mkdirSync(join(web, "app"), { recursive: true });
  writeFileSync(join(web, "app", "page.tsx"), "export default 1");
  touch(join(web, "app", "page.tsx"), "2026-01-01T00:00:00Z");
});
afterEach(() => rmSync(web, { recursive: true, force: true }));

/** A fake `next build` that writes the export, as if it finished at `finishedAt`. */
function fakeBuild(finishedAt: string, during?: () => void) {
  let runs = 0;
  const build = () => {
    runs++;
    during?.();
    mkdirSync(join(web, "out"), { recursive: true });
    writeFileSync(join(web, "out", "index.html"), "");
    touch(join(web, "out", "index.html"), finishedAt);
    return null;
  };
  return { build, runs: () => runs };
}

describe("lockState", () => {
  const NOW = Date.parse("2026-10-09T12:00:00Z");
  test("free without a lock", () => {
    expect(lockState(null, NOW, () => true)).toBe("free");
  });
  test("held while its process runs and it is recent", () => {
    expect(lockState({ pid: 42, startedAt: NOW - 60_000 }, NOW, () => true)).toBe("held");
  });
  test("abandoned when its process is gone, or it is older than a build can take", () => {
    expect(lockState({ pid: 42, startedAt: NOW - 60_000 }, NOW, () => false)).toBe("abandoned");
    expect(lockState({ pid: 42, startedAt: NOW - 60 * 60_000 }, NOW, () => true)).toBe("abandoned");
  });
});

describe("ensureExport", () => {
  test("builds when the export is missing, records the build's start, and removes its lock", () => {
    const fake = fakeBuild("2026-01-02T00:00:10Z");
    const result = ensureExport(web, { build: fake.build, now: () => Date.parse("2026-01-02T00:00:00Z"), log: () => {} });
    expect(result).toEqual({ built: true, error: null });
    expect(fake.runs()).toBe(1);
    expect(existsSync(join(web, BUILD_LOCK))).toBe(false);
    expect(isExportStale(web)).toBe(false);
  });

  test("an edit made during the build makes the export stale for the next start", () => {
    // The build starts at 00:00, the source is saved at 00:05, the export lands at 00:10.
    const fake = fakeBuild("2026-01-02T00:00:10Z", () => touch(join(web, "app", "page.tsx"), "2026-01-02T00:00:05Z"));
    ensureExport(web, { build: fake.build, now: () => Date.parse("2026-01-02T00:00:00Z"), log: () => {} });
    expect(isExportStale(web)).toBe(true);
  });

  test("skips the build when the export is up to date", () => {
    const fake = fakeBuild("2026-01-02T00:00:10Z");
    ensureExport(web, { build: fake.build, now: () => Date.parse("2026-01-02T00:00:00Z"), log: () => {} });
    expect(ensureExport(web, { build: fake.build, log: () => {} })).toEqual({ built: false, error: null });
    expect(fake.runs()).toBe(1);
  });

  test("a second start waits for a running build instead of building at the same time", () => {
    writeFileSync(join(web, BUILD_LOCK), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    const fake = fakeBuild("2026-01-02T00:00:10Z");
    const messages: string[] = [];
    let waited = 0;
    const result = ensureExport(web, {
      build: fake.build,
      log: (m) => messages.push(m),
      // The other start finishes its build while this one waits.
      sleep: () => {
        waited++;
        fake.build();
        rmSync(join(web, BUILD_LOCK));
      },
    });
    expect(waited).toBe(1);
    expect(fake.runs()).toBe(1); // only the other start's build
    expect(result).toEqual({ built: false, error: null });
    expect(messages.join("\n")).toContain("another dashboard start is building the app");
  });

  test("gives up waiting after the timeout with a clear message, and never builds alongside", () => {
    writeFileSync(join(web, BUILD_LOCK), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    const fake = fakeBuild("2026-01-02T00:00:10Z");
    let clock = 0;
    const result = ensureExport(web, {
      build: fake.build,
      log: () => {},
      now: () => Date.now() + clock,
      sleep: (ms) => {
        clock += ms;
      },
      waitMs: 5_000,
    });
    expect(fake.runs()).toBe(0);
    expect(result.built).toBe(false);
    expect(result.error).toContain("still building");
  });

  test("takes over a lock left by a start that died", () => {
    writeFileSync(join(web, BUILD_LOCK), JSON.stringify({ pid: 2_147_483_646, startedAt: Date.now() }));
    const fake = fakeBuild("2026-01-02T00:00:10Z");
    const result = ensureExport(web, { build: fake.build, log: () => {} });
    expect(result).toEqual({ built: true, error: null });
    expect(existsSync(join(web, BUILD_LOCK))).toBe(false);
  });

  test("a failed build is reported and leaves no lock and no build record", () => {
    const result = ensureExport(web, { build: () => "next build failed", log: () => {} });
    expect(result).toEqual({ built: false, error: "next build failed" });
    expect(existsSync(join(web, BUILD_LOCK))).toBe(false);
    expect(readFileSync(join(web, "app", "page.tsx"), "utf8")).toBe("export default 1");
    expect(isExportStale(web)).toBe(true);
  });
});
