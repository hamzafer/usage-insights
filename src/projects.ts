import { readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

/**
 * Project resolution (spec §4, GLOSSARY: Project): a working directory from a log maps to the
 * root of its git repository, so worktrees and subfolders merge into one Project. Reads `.git`
 * entries on disk only (no `git` process), so it is fast enough for every log line and works
 * for directories that were deleted since (their nearest existing parent decides).
 */

export interface ProjectResolver {
  /** The main repository root of `cwd`, or null when it lies in no repository. */
  resolve(cwd: string): string | null;
}

/** How a Project is shown: its folder name only, never the full path; null is "(other)". */
export function projectName(root: string | null): string {
  return root === null ? OTHER_PROJECT : basename(root);
}

export const OTHER_PROJECT = "(other)";

/** Claude Code puts its worktrees here, inside the repository they belong to. */
const CLAUDE_WORKTREES = "/.claude/worktrees/";

export function createProjectResolver(): ProjectResolver {
  const cache = new Map<string, string | null>();

  const resolveDir = (dir: string): string | null => {
    const cached = cache.get(dir);
    if (cached !== undefined) return cached;
    const found = repoRootAt(dir) ?? (dirname(dir) === dir ? null : resolveDir(dirname(dir)));
    cache.set(dir, found);
    return found;
  };

  return {
    resolve(cwd) {
      if (!cwd || !isAbsolute(cwd)) return null;
      let dir = resolve(cwd);
      const worktrees = dir.indexOf(CLAUDE_WORKTREES);
      if (worktrees > 0) dir = dir.slice(0, worktrees);
      return resolveDir(dir);
    },
  };
}

/** The main repository root when `dir` holds a `.git` entry, else null. */
function repoRootAt(dir: string): string | null {
  const dotGit = resolve(dir, ".git");
  let isDir: boolean;
  try {
    isDir = statSync(dotGit).isDirectory();
  } catch {
    return null;
  }
  if (isDir) return dir;
  // A linked worktree (or submodule): `.git` is a file naming its git dir.
  return mainRootOfGitFile(dotGit) ?? dir;
}

/**
 * A worktree's git dir holds `commondir`, pointing at the main repository's `.git`; its parent is
 * the main checkout. Without one (a submodule) the folder is its own Project.
 */
function mainRootOfGitFile(dotGitFile: string): string | null {
  try {
    const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGitFile, "utf8"));
    if (!match) return null;
    const gitdir = resolve(dirname(dotGitFile), match[1]!.trim());
    const common = resolve(gitdir, readFileSync(resolve(gitdir, "commondir"), "utf8").trim());
    return basename(common) === ".git" ? dirname(common) : null;
  } catch {
    return null;
  }
}
