import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Keeps the dashboard app's static export (`web/out`, ADR 0003) in step with its sources: rebuilt
 * when missing or older than any source file, skipped (a few stat calls) when up to date.
 */

/** Generated or installed folders in `web/`: never sources. */
const NOT_SOURCES = new Set(["node_modules", ".next", "out"]);

/** True when `<webDir>/out` is missing or older than the newest source file in `webDir`. */
export function isExportStale(webDir: string): boolean {
  const built = mtime(join(webDir, "out", "index.html"));
  if (built === null) return true;
  return newestSource(webDir) > built;
}

/**
 * Builds the export: installs dependencies when `node_modules` is missing, then `next build`.
 * Returns an error message, or null on success.
 */
export function buildExport(webDir: string, log: (m: string) => void = console.log): string | null {
  const run = (cmd: string[]) => {
    log(`dashboard: ${cmd.join(" ")} (in web/)`);
    const result = Bun.spawnSync(cmd, { cwd: webDir, stdout: "inherit", stderr: "inherit" });
    return result.exitCode === 0 ? null : `"${cmd.join(" ")}" failed (exit ${result.exitCode})`;
  };
  if (!existsSync(join(webDir, "node_modules"))) {
    const failed = run(["bun", "install", "--frozen-lockfile"]);
    if (failed) return failed;
  }
  return run(["bun", "run", "build"]);
}

function newestSource(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (NOT_SOURCES.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestSource(path));
    else if (entry.isFile()) newest = Math.max(newest, mtime(path) ?? 0);
  }
  return newest;
}

function mtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}
