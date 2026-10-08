import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store.ts";

// `bun run report` end to end, in a temp data directory with an empty Telegram state directory,
// so no real bot is ever reached.
const root = new URL("..", import.meta.url).pathname;
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "usage-insights-report-"));
  mkdirSync(join(dataDir, "telegram"));
  const store = openStore(join(dataDir, "usage.db"));
  const weekly = { provider: "codex", label: "Weekly", role: "cycle" as const, limit: 100, unit: "percent", periodMs: null, plan: null };
  const day = 24 * 3_600_000;
  const t = (offset: number) => new Date(Date.now() - offset).toISOString();
  const reset = t(2 * day);
  store.saveReadings([
    { ...weekly, used: 50, resetsAt: reset, fetchedAt: t(3 * day), recordedAt: t(3 * day) },
    { ...weekly, used: 75, resetsAt: reset, fetchedAt: t(2 * day + 600_000), recordedAt: t(2 * day + 600_000) },
  ]);
  store.close();
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

function run(...args: string[]) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    USAGE_INSIGHTS_DATA_DIR: dataDir,
    USAGE_INSIGHTS_CODEX_DIR: join(dataDir, "no-codex"),
    USAGE_INSIGHTS_CLAUDE_DIR: join(dataDir, "no-claude"),
    USAGE_INSIGHTS_CLAUDE_WORK_DIR: join(dataDir, "no-claude-work"),
    TELEGRAM_STATE_DIR: join(dataDir, "telegram"),
    TZ: "UTC",
    // Claude is never reached: a test key and a closed local port.
    ANTHROPIC_API_KEY: "test-key",
    USAGE_INSIGHTS_ANTHROPIC_URL: "http://127.0.0.1:9/v1/messages",
  };
  delete env.TELEGRAM_BOT_TOKEN;
  delete env.USAGE_INSIGHTS_TELEGRAM_CHAT_ID;
  const proc = Bun.spawnSync(["bun", "run", "src/cli/report.ts", ...args], { cwd: root, env });
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

test("--dry-run --test prints the [TEST] message and the Report, saving nothing", () => {
  const out = run("--dry-run", "--test");
  expect(out.code).toBe(0);
  expect(out.out).toContain("[TEST] <b>📊 Usage week · ");
  expect(out.out).toContain("Codex reset 1× · 25% wasted");
  expect(out.out).toContain("## Numbers");
  expect(existsSync(join(dataDir, "reports"))).toBe(false);
});

test("without Telegram config the Report is saved, and the run fails naming the missing key", () => {
  const out = run();
  expect(out.code).toBe(1);
  expect(out.out).toContain("Report not delivered: Telegram bot token not found: no TELEGRAM_BOT_TOKEN in");
  const today = new Date().toISOString().slice(0, 10);
  expect(readFileSync(join(dataDir, "reports", `${today}.md`), "utf8")).toContain("| Codex | Weekly |");
});

test("an unknown option is refused", () => {
  expect(run("--send-now").code).toBe(64);
});

test("a missing Setup file is drafted, and a failed Claude call still lets the Report out", () => {
  const out = run("--dry-run");
  expect(out.code).toBe(0);
  expect(out.out).toContain("Setup is a DRAFT");
  expect(out.out).toContain("Suggestions unavailable: Claude API unreachable");
  expect(out.out).toContain("## Numbers");
  expect(out.out).not.toContain("test-key");
  expect(readFileSync(join(dataDir, "setup.md"), "utf8").split("\n")[0]).toContain("DRAFT");
});

test("setup:draft writes the DRAFT template once and never overwrites", () => {
  const env = { ...process.env, USAGE_INSIGHTS_DATA_DIR: dataDir };
  const first = Bun.spawnSync(["bun", "run", "src/cli/setup-draft.ts"], { cwd: root, env });
  expect(first.exitCode).toBe(0);
  expect(first.stdout.toString()).toContain("Drafted");
  writeFileSync(join(dataDir, "setup.md"), "# Mine\n");
  const second = Bun.spawnSync(["bun", "run", "src/cli/setup-draft.ts"], { cwd: root, env });
  expect(second.exitCode).toBe(0);
  expect(second.stdout.toString()).toContain("already exists");
  expect(readFileSync(join(dataDir, "setup.md"), "utf8")).toBe("# Mine\n");
});
