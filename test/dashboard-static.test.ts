import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dashboardHandler } from "../src/dashboard/server.ts";
import { resolveStaticFile } from "../src/dashboard/static.ts";
import { isExportStale } from "../src/dashboard/web-build.ts";
import { NOW, syntheticData } from "./dashboard-fixtures.ts";

// The app's static export (ADR 0003), served by the dashboard handler next to the API.
let dir: string;
let out: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-insights-web-"));
  out = join(dir, "out");
  mkdirSync(join(out, "_next", "static", "chunks"), { recursive: true });
  writeFileSync(join(out, "index.html"), "<!doctype html><title>app</title>");
  writeFileSync(join(out, "analytics.html"), "<!doctype html><title>analytics</title>");
  writeFileSync(join(out, "404.html"), "<!doctype html><title>missing</title>");
  writeFileSync(join(out, "_next", "static", "chunks", "app.js"), "console.log(1)");
  writeFileSync(join(out, "_next", "static", "chunks", "app.css"), "body{}");
  writeFileSync(join(dir, "secret.txt"), "outside the export");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function handler(staticDir: string | undefined = out) {
  return dashboardHandler({ load: () => syntheticData(), now: () => new Date(NOW), timeZone: "UTC", staticDir });
}

async function get(path: string, staticDir?: string) {
  const res = await handler(staticDir)(new Request(`http://127.0.0.1:6740${path}`));
  return { status: res.status, type: res.headers.get("content-type") ?? "", cache: res.headers.get("cache-control"), body: await res.text() };
}

describe("static export", () => {
  test("serves the app at / and routes as their .html files", async () => {
    expect(await get("/")).toMatchObject({ status: 200, type: "text/html; charset=utf-8", body: expect.stringContaining("app") });
    expect((await get("/analytics")).body).toContain("analytics");
    expect((await get("/analytics/")).body).toContain("analytics");
  });

  test("serves assets with their content type; hashed build assets are cached for good", async () => {
    const js = await get("/_next/static/chunks/app.js");
    expect(js.type).toBe("text/javascript; charset=utf-8");
    expect(js.cache).toContain("immutable");
    expect((await get("/_next/static/chunks/app.css")).type).toBe("text/css; charset=utf-8");
    expect((await get("/")).cache).toBe("no-store");
  });

  test("an unknown path gets the export's 404 page", async () => {
    expect(await get("/nope")).toMatchObject({ status: 404, body: expect.stringContaining("missing") });
  });

  test("never serves files outside the export", async () => {
    for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/_next/%2e%2e/%2e%2e/secret.txt", "/%2e%2e%2fsecret.txt", "/a%00.html"]) {
      const res = await get(path);
      expect(res.body).not.toContain("outside the export");
    }
    expect(resolveStaticFile(out, "/%2e%2e/secret.txt")).toBeNull();
    expect(resolveStaticFile(out, "/..%5csecret.txt")).toBeNull();
    expect(resolveStaticFile(out, "/%E0%A4%A")).toBeNull();
  });

  test("the API sits next to the export; the old page paths are gone", async () => {
    const api = await get("/api/overview");
    expect(api.type).toContain("application/json");
    expect((await get("/api/nope")).status).toBe(404);
    for (const path of ["/legacy", "/health", "/projects", "/provider/codex"]) {
      expect(await get(path)).toMatchObject({ status: 404, body: expect.stringContaining("missing") });
    }
  });

  test("without a built export, / says how to build it", async () => {
    const res = await get("/", join(dir, "missing"));
    expect(res.status).toBe(503);
    expect(res.body).toContain("bun run web:build");
  });
});

describe("export freshness", () => {
  test("is stale when missing, or older than any source; fresh otherwise", () => {
    const web = join(dir, "web");
    mkdirSync(join(web, "app"), { recursive: true });
    mkdirSync(join(web, "node_modules"), { recursive: true });
    writeFileSync(join(web, "app", "page.tsx"), "export default 1");
    expect(isExportStale(web)).toBe(true);

    mkdirSync(join(web, "out"));
    writeFileSync(join(web, "out", "index.html"), "");
    const old = new Date("2026-01-01T00:00:00Z");
    const later = new Date("2026-01-02T00:00:00Z");
    utimesSync(join(web, "app", "page.tsx"), old, old);
    utimesSync(join(web, "out", "index.html"), later, later);
    // Installed dependencies are not sources.
    writeFileSync(join(web, "node_modules", "dep.js"), "");
    expect(isExportStale(web)).toBe(false);

    utimesSync(join(web, "app", "page.tsx"), new Date("2026-01-03T00:00:00Z"), new Date("2026-01-03T00:00:00Z"));
    expect(isExportStale(web)).toBe(true);
  });
});
