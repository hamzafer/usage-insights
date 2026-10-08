import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Setup file (GLOSSARY: Setup): `<data dir>/setup.md`, written by the user and never kept in the
 * repo (ADR 0002). A drafted file says DRAFT on its first line; Reports say so until the user removes it.
 * A filled-in generic example lives in `docs/setup.example.md`.
 */

export const SETUP_FILE = "setup.md";

export const DRAFT_TEMPLATE = `# Setup (DRAFT: fill this in, then remove the word DRAFT from this line)

Claude reads this file to write the weekly Suggestions. Plain Markdown; keep it short.

## Providers and plans

For each: plan, price per month (or "unknown, fill in"), and which jobs it does.

- Claude: plan unknown, fill in. Jobs: ...
- Codex: plan unknown, fill in. Jobs: ...

## Goals

- Reduce Waste (allowance left unused at Reset)
- Avoid Limit Hits
`;

/** True while the file's first line contains "DRAFT". */
export function isDraftSetup(text: string): boolean {
  return (text.split("\n", 1)[0] ?? "").includes("DRAFT");
}

/** Reads `<dataDir>/setup.md`, or returns the DRAFT template when it is missing. Writes nothing (dry runs). */
export function peekSetup(dataDir: string): string {
  const path = join(dataDir, SETUP_FILE);
  return existsSync(path) ? readFileSync(path, "utf8") : DRAFT_TEMPLATE;
}

/** Reads `<dataDir>/setup.md`, first writing the DRAFT template when it is missing. Never overwrites. */
export function ensureSetup(dataDir: string): { created: boolean; text: string } {
  const path = join(dataDir, SETUP_FILE);
  if (existsSync(path)) return { created: false, text: readFileSync(path, "utf8") };
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path, DRAFT_TEMPLATE, { flag: "wx" });
  return { created: true, text: DRAFT_TEMPLATE };
}
