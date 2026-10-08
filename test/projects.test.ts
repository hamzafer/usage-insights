import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjectResolver, projectName } from "../src/projects.ts";

// Synthetic repositories in a temp directory (ADR 0002): a main checkout, a linked worktree,
// a Claude Code worktree under `.claude/worktrees/`, and a folder that is no repository.
let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "usage-insights-projects-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A main checkout at `dir` with a `.git` directory. */
function repo(dir: string): string {
  mkdirSync(join(dir, ".git", "worktrees"), { recursive: true });
  writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  return dir;
}

/** A linked worktree at `dir` of the repository at `main`, as `git worktree add` lays it out. */
function worktree(main: string, dir: string, name: string): string {
  const gitdir = join(main, ".git", "worktrees", name);
  mkdirSync(gitdir, { recursive: true });
  writeFileSync(join(gitdir, "commondir"), "../..\n");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".git"), `gitdir: ${gitdir}\n`);
  return dir;
}

test("a subfolder resolves to its repository root", () => {
  const main = repo(join(root, "alpha"));
  mkdirSync(join(main, "src", "deep"), { recursive: true });
  expect(createProjectResolver().resolve(join(main, "src", "deep"))).toBe(main);
});

test("a linked worktree elsewhere resolves to the main repository", () => {
  const main = repo(join(root, "alpha"));
  const wt = worktree(main, join(root, "alpha-feature"), "alpha-feature");
  mkdirSync(join(wt, "src"));
  expect(createProjectResolver().resolve(join(wt, "src"))).toBe(main);
});

test("a Claude Code worktree under .claude/worktrees resolves to the main repository", () => {
  const main = repo(join(root, "alpha"));
  const wt = worktree(main, join(main, ".claude", "worktrees", "agent-1"), "agent-1");
  expect(createProjectResolver().resolve(wt)).toBe(main);
});

test("a deleted Claude Code worktree still resolves to the main repository", () => {
  const main = repo(join(root, "alpha"));
  expect(createProjectResolver().resolve(join(main, ".claude", "worktrees", "gone", "src"))).toBe(main);
});

test("a deleted subfolder resolves through its nearest existing parent", () => {
  const main = repo(join(root, "alpha"));
  expect(createProjectResolver().resolve(join(main, "removed", "dir"))).toBe(main);
});

test("a folder outside any repository is unresolvable", () => {
  mkdirSync(join(root, "scratch"));
  const resolver = createProjectResolver();
  expect(resolver.resolve(join(root, "scratch"))).toBeNull();
  expect(resolver.resolve(join(root, "never-existed"))).toBeNull();
  expect(resolver.resolve("")).toBeNull();
  expect(resolver.resolve("relative/path")).toBeNull();
});

test("a worktree whose .git file is unreadable falls back to its own folder", () => {
  const dir = join(root, "broken");
  mkdirSync(dir);
  writeFileSync(join(dir, ".git"), "not a gitdir line\n");
  expect(createProjectResolver().resolve(dir)).toBe(dir);
});

test("lookups are cached per directory", () => {
  const main = repo(join(root, "alpha"));
  const resolver = createProjectResolver();
  expect(resolver.resolve(main)).toBe(main);
  rmSync(main, { recursive: true });
  expect(resolver.resolve(main)).toBe(main);
});

test("a Project is shown by its folder name only, unresolvable ones as (other)", () => {
  expect(projectName(join(root, "alpha"))).toBe("alpha");
  expect(projectName(null)).toBe("(other)");
});
