import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAFT_TEMPLATE, ensureSetup, isDraftSetup, peekSetup } from "../src/report/setup.ts";

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "usage-insights-setup-"));
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

test("a missing Setup file is drafted from the template, marked DRAFT on line 1", () => {
  const first = ensureSetup(dataDir);
  expect(first.created).toBe(true);
  expect(isDraftSetup(first.text)).toBe(true);
  expect(readFileSync(join(dataDir, "setup.md"), "utf8")).toBe(first.text);
  expect(first.text).toContain("Providers and plans");
});

test("an existing Setup file is read, never overwritten", () => {
  writeFileSync(join(dataDir, "setup.md"), "# My Setup\n\n- Codex: reviews\n");
  expect(ensureSetup(dataDir)).toEqual({ created: false, text: "# My Setup\n\n- Codex: reviews\n" });
});

test("peekSetup reads the Setup file, or gives the DRAFT template without writing it (dry runs)", () => {
  expect(peekSetup(dataDir)).toBe(DRAFT_TEMPLATE);
  expect(existsSync(join(dataDir, "setup.md"))).toBe(false);
  writeFileSync(join(dataDir, "setup.md"), "# Mine\n");
  expect(peekSetup(dataDir)).toBe("# Mine\n");
});

test("DRAFT counts only on the first line", () => {
  expect(isDraftSetup("# Setup (DRAFT)\n- x")).toBe(true);
  expect(isDraftSetup("# Setup\n- the DRAFT word later")).toBe(false);
});
