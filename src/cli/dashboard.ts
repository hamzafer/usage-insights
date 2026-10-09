// The local dashboard (`bun run dashboard`): the app in web/ (a static export, ADR 0003) and the
// JSON API on one port, bound to 127.0.0.1 only (ADR 0002: local for now; hosting later only behind
// a login). Builds the export first when it is missing or older than web/'s sources; `--no-build`
// skips that and serves whatever export exists (pages say how to build it when there is none).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { dashboardPort, loadConfig } from "../config.ts";
import { loadDashboardData } from "../dashboard/data.ts";
import { dashboardHandler } from "../dashboard/server.ts";
import { hasExport } from "../dashboard/static.ts";
import { ensureExport } from "../dashboard/web-build.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });

const webDir = join(import.meta.dir, "..", "..", "web");
const staticDir = join(webDir, "out");
if (!process.argv.includes("--no-build")) {
  // One build at a time: a second start waits for the first one's build (web-build.ts).
  const { error } = ensureExport(webDir);
  if (error) console.error(`dashboard: could not build the app (${error}); serving the last export, if any.`);
}
if (!hasExport(staticDir)) {
  console.error("dashboard: no built app in web/out yet; pages will say so. Run `bun run web:build` (or drop --no-build).");
}

const port = dashboardPort();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  // `port` also limits the Host header to 127.0.0.1 or localhost at this port (DNS rebinding).
  fetch: dashboardHandler({ load: (needs) => loadDashboardData(config.dbPath, needs), port, staticDir }),
});

console.log(`Usage Insights dashboard on http://127.0.0.1:${server.port}`);
