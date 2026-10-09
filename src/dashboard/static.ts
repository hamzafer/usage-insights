import { statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

/**
 * Serves the dashboard app's static export (`web/out`, ADR 0003). A route without an extension maps
 * to its `.html` file or folder `index.html` (`/analytics` → `analytics.html`). Paths never leave
 * the export folder: `..`, encoded slashes and NUL bytes are refused.
 */

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".webmanifest": "application/manifest+json",
};

/** The file in `dir` for a URL path, or null when there is none (or the path tries to leave `dir`). */
export function resolveStaticFile(dir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const parts = decoded.split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) return null;

  const root = resolve(dir);
  const base = join(root, ...parts);
  if (base !== root && !base.startsWith(root + sep)) return null;
  const candidates = extname(base) ? [base] : [`${base}.html`, join(base, "index.html")];
  if (base === root) candidates.splice(0, candidates.length, join(root, "index.html"));
  return candidates.find(isFile) ?? null;
}

/** A response for a static file, or null when there is no such file. */
export function serveStatic(dir: string, pathname: string, method: string): Response | null {
  const file = resolveStaticFile(dir, pathname);
  if (!file) return null;
  return fileResponse(file, 200, method, pathname.startsWith("/_next/static/"));
}

/** The export's 404 page, when it has one. */
export function staticNotFound(dir: string, method: string): Response | null {
  const file = join(resolve(dir), "404.html");
  return isFile(file) ? fileResponse(file, 404, method, false) : null;
}

/** True when `dir` holds a built export (its `index.html`). */
export function hasExport(dir: string | undefined): dir is string {
  return dir !== undefined && isFile(join(resolve(dir), "index.html"));
}

function fileResponse(file: string, status: number, method: string, immutable: boolean): Response {
  const headers = {
    "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    // Hashed build assets never change; pages are re-read so a rebuild shows at once.
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-store",
    "x-content-type-options": "nosniff",
  };
  return new Response(method === "HEAD" ? null : Bun.file(file), { status, headers });
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
