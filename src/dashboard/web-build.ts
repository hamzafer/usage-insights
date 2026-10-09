import { closeSync, existsSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Keeps the dashboard app's static export (`web/out`, ADR 0003) in step with its sources: rebuilt
 * when missing or older than any source file, skipped (a few stat calls) when up to date. One build
 * at a time: a lockfile makes a second `bun run dashboard` wait for the first one's build.
 */

/** Held (created exclusively) while one start builds the export: `{ pid, startedAt }`. */
export const BUILD_LOCK = ".dashboard-build.lock";
/** The last build made here: when it started, and the export it produced (to recognise it later). */
export const BUILD_RECORD = ".dashboard-build.json";
/** A lock older than this is from a build that hung or died: taken over. */
const LOCK_MAX_AGE_MS = 30 * 60_000;

/** Generated or installed folders and files in `web/`: never sources. */
const NOT_SOURCES = new Set(["node_modules", ".next", "out", BUILD_LOCK, BUILD_RECORD]);

/**
 * True when `<webDir>/out` is missing or older than the newest source file in `webDir`. "Older" is
 * measured from the build's start when ensureExport built it, so a file saved during a build makes
 * the export stale for the next start (an export built another way counts from its own mtime).
 */
export function isExportStale(webDir: string): boolean {
  const built = builtAt(webDir);
  if (built === null) return true;
  return newestSource(webDir) > built;
}

function builtAt(webDir: string): number | null {
  const exported = mtime(join(webDir, "out", "index.html"));
  if (exported === null) return null;
  const record = readJson<{ startedAt: number; exportMtime: number }>(join(webDir, BUILD_RECORD));
  return record && record.exportMtime === exported ? record.startedAt : exported;
}

export type LockState = "free" | "held" | "abandoned";

/** Whether a build lock blocks building: held by a live, recent start; else free or abandoned. */
export function lockState(
  lock: { pid: number; startedAt: number } | null,
  now: number,
  isAlive: (pid: number) => boolean = processAlive,
): LockState {
  if (!lock) return "free";
  if (now - lock.startedAt > LOCK_MAX_AGE_MS || !isAlive(lock.pid)) return "abandoned";
  return "held";
}

export interface EnsureOptions {
  /** Builds the export; returns an error message or null. `buildExport` by default. */
  build?: () => string | null;
  log?: (message: string) => void;
  now?: () => number;
  sleep?: (ms: number) => void;
  /** How long to wait for another start's build before giving up. */
  waitMs?: number;
  pollMs?: number;
}

/**
 * Builds the export when it is stale, one build at a time. When another start holds the lock, waits
 * for it (then builds only if the export is still stale); after `waitMs` it gives up with an error,
 * so the caller serves whatever export exists. Never runs two `next build`s in the same folder.
 */
export function ensureExport(webDir: string, options: EnsureOptions = {}): { built: boolean; error: string | null } {
  const log = options.log ?? console.log;
  const build = options.build ?? (() => buildExport(webDir, log));
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => Bun.sleepSync(ms));
  const waitMs = options.waitMs ?? 10 * 60_000;
  const pollMs = options.pollMs ?? 1_000;
  const lockPath = join(webDir, BUILD_LOCK);
  let waitingSince: number | null = null;

  for (;;) {
    if (!isExportStale(webDir)) return { built: false, error: null };
    const state = lockState(readJson(lockPath), now());
    if (state === "held") {
      if (waitingSince === null) {
        waitingSince = now();
        log("dashboard: another dashboard start is building the app; waiting for it to finish...");
      } else if (now() - waitingSince >= waitMs) {
        return {
          built: false,
          error: `another dashboard start is still building the app after ${Math.round(waitMs / 1000)}s`,
        };
      }
      sleep(pollMs);
      continue;
    }
    if (state === "abandoned") rmSync(lockPath, { force: true });
    const startedAt = now();
    if (!acquire(lockPath, { pid: process.pid, startedAt })) continue; // another start got it first
    try {
      const error = build();
      if (error) return { built: false, error };
      const exportMtime = mtime(join(webDir, "out", "index.html"));
      if (exportMtime !== null) writeFileSync(join(webDir, BUILD_RECORD), JSON.stringify({ startedAt, exportMtime }));
      return { built: true, error: null };
    } finally {
      rmSync(lockPath, { force: true });
    }
  }
}

/**
 * Builds the export: installs dependencies when `node_modules` is missing, then `next build`.
 * Returns an error message, or null on success. Use ensureExport, which holds the build lock.
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

/** Creates the lock file exclusively; false when it already exists. */
function acquire(path: string, lock: { pid: number; startedAt: number }): boolean {
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
  try {
    writeFileSync(fd, JSON.stringify(lock));
  } finally {
    closeSync(fd);
  }
  return true;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
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
