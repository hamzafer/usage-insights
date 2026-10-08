/**
 * Runs `sql` in another process inside BEGIN IMMEDIATE (so that process holds the write lock), and
 * resolves once the lock is held. The other process commits after `holdMs`; `done` gives its exit code.
 */
export async function holdWriteLock(path: string, holdMs: number, sql = ""): Promise<{ done: Promise<number> }> {
  const script = `
    const { Database } = require("bun:sqlite");
    const db = new Database(process.argv[1]);
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("BEGIN IMMEDIATE");
    if (process.argv[3]) db.exec(process.argv[3]);
    console.log("locked");
    Bun.sleepSync(Number(process.argv[2]));
    db.exec("COMMIT");
    db.close();
  `;
  const child = Bun.spawn(["bun", "-e", script, path, String(holdMs), sql], { stdout: "pipe", stderr: "inherit" });
  const reader = child.stdout.getReader();
  let out = "";
  while (!out.includes("locked")) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`lock holder exited early: ${out}`);
    out += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  return { done: child.exited };
}
